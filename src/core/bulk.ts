import { ADAPTERS } from "../adapters";
import { buildConversationFromBulk } from "../content/bulk-builder";
import { getSettings } from "./settings";
import { getProviderBaseUrl, getProviderConversationUrl, providerMatchesUrl } from "./provider-urls";
import { logger } from "./logger";
import type { Attachment, BulkConversationItem, BulkExportResult, Conversation, ExportFormat, ProviderId, RuntimeMessage } from "./types";

export interface BulkExportOptions {
  providerId: ProviderId;
  conversationIds: string[];
  formats: ExportFormat[];
  saveAttachments?: boolean;
  onProgress?: (done: number, total: number, result?: BulkExportResult) => void;
}

interface DomListResponse {
  ok: true;
  items: BulkConversationItem[];
  total?: number;
}

interface DomDetailResponse {
  ok: true;
  conversation: Conversation;
}

function adapterForProvider(providerId: ProviderId) {
  return ADAPTERS.find((adapter) => adapter.id === providerId);
}

function sendToTab<T>(tabId: number, msg: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

async function getActiveProviderTab(providerId: ProviderId): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find((tab) => tab.url && providerMatchesUrl(providerId, tab.url));
}

async function createProviderTab(providerId: ProviderId, conversationId?: string): Promise<chrome.tabs.Tab> {
  const url = conversationId ? getProviderConversationUrl(providerId, conversationId) : getProviderBaseUrl(providerId);
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error(`Failed to create tab for ${providerId}`);
  return tab;
}

async function waitForTab(tabId: number, timeoutMs = 30000) {
  const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, updatedTab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(updatedTab);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for provider tab"));
    }, timeoutMs);
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return tab;
}

async function getAuthContext(providerId: ProviderId): Promise<string> {
  const adapter = adapterForProvider(providerId);
  let active = await getActiveProviderTab(providerId);
  if (!active) {
    try {
      const tab = await createProviderTab(providerId);
      if (tab.id) {
        active = await waitForTab(tab.id);
      }
    } catch {
      return "";
    }
  }

  if (!active?.id) return "";
  try {
    const response = await sendToTab<{ ok: true; authContext?: string }>(active.id, { kind: "bulk-auth-context" } as RuntimeMessage);
    return response?.ok ? response.authContext || "" : "";
  } catch (err: any) {
    logger.warn(`Could not read auth context from ${providerId} tab`, { error: err.message });
    return "";
  }
}

async function fetchListFromDom(providerId: ProviderId, limit: number, offset: number): Promise<{ items: BulkConversationItem[]; nextOffset?: number; total?: number }> {
  let tab = await getActiveProviderTab(providerId);
  let created = false;
  if (!tab) {
    tab = await createProviderTab(providerId);
    if (tab.id) {
      await waitForTab(tab.id);
      created = true;
    }
  }

  if (!tab?.id) throw new Error(`No ${providerId} tab available for DOM fallback`);

  try {
    const response = await sendToTab<DomListResponse>(tab.id, { kind: "bulk-list-from-dom", limit, offset } as RuntimeMessage);
    if (!response?.ok) throw new Error("DOM list extraction returned no data");
    const items = response.items.slice(0, limit);
    return {
      items,
      nextOffset: items.length === limit ? offset + limit : undefined,
      total: response.total ?? items.length,
    };
  } finally {
    if (created && tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function fetchDetailFromDom(providerId: ProviderId, conversationId: string): Promise<Conversation> {
  const conversationUrl = getProviderConversationUrl(providerId, conversationId);
  let tab = await getActiveProviderTab(providerId);
  let created = false;

  if (!tab?.url || !conversationUrl.startsWith(tab.url)) {
    tab = await createProviderTab(providerId, conversationId);
    if (tab.id) {
      await waitForTab(tab.id);
      created = true;
    }
  }

  if (!tab?.id) throw new Error(`No ${providerId} tab available for DOM detail fallback`);

  try {
    const response = await sendToTab<DomDetailResponse>(tab.id, { kind: "bulk-detail-from-dom" } as RuntimeMessage);
    if (!response?.ok || !response.conversation) throw new Error("DOM detail extraction returned no data");
    return response.conversation;
  } finally {
    if (created && tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

export async function fetchConversationList(
  providerId: ProviderId,
  limit: number = 30,
  offset: number = 0
): Promise<{ items: BulkConversationItem[]; nextOffset?: number; total?: number }> {
  const adapter = adapterForProvider(providerId);
  if (!adapter) throw new Error(`No adapter for provider: ${providerId}`);

  const authContext = await getAuthContext(providerId);

  if (adapter.fetchList) {
    try {
      return await adapter.fetchList(authContext, limit, offset);
    } catch (err: any) {
      logger.warn(`${providerId} bulk list API failed, using DOM fallback`, { error: err.message });
    }
  }

  return fetchListFromDom(providerId, limit, offset);
}

export async function fetchConversationDetail(
  providerId: ProviderId,
  conversationId: string
): Promise<any> {
  const adapter = adapterForProvider(providerId);
  if (!adapter) throw new Error(`No adapter for provider: ${providerId}`);

  const authContext = await getAuthContext(providerId);

  if (adapter.fetchDetail) {
    try {
      return await adapter.fetchDetail(authContext, conversationId);
    } catch (err: any) {
      logger.warn(`${providerId} bulk detail API failed, using DOM fallback`, { error: err.message });
    }
  }

  return fetchDetailFromDom(providerId, conversationId);
}

export async function runBulkExport(
  options: BulkExportOptions
): Promise<BulkExportResult[]> {
  const { providerId, conversationIds, formats, saveAttachments = false, onProgress } = options;
  const settings = await getSettings();
  const exportFormats = formats.length > 0 ? formats : settings.enabledFormats;
  const results: BulkExportResult[] = [];

  for (let index = 0; index < conversationIds.length; index++) {
    const id = conversationIds[index];
    try {
      logger.info(`Bulk exporting conversation: ${id}`);
      const detail = await fetchConversationDetail(providerId, id);
      const conv = await buildConversationFromBulk(providerId, detail, {
        saveAttachments,
        attachmentsFolder: settings.attachmentsFolder,
      });

      const response = await chrome.runtime.sendMessage({
        kind: "save-conversation",
        conversation: conv,
        formats: exportFormats,
      } as RuntimeMessage);

      const result: BulkExportResult = response?.ok
        ? { id, title: conv.title, success: true, formats: exportFormats, filename: conv.title }
        : { id, title: conv.title || id, success: false, error: response?.error || "Unknown save error" };

      results.push(result);
      onProgress?.(index + 1, conversationIds.length, result);
    } catch (err: any) {
      logger.error(`Bulk export failed for ${id}`, err);
      const result: BulkExportResult = { id, title: id, success: false, error: err.message || "Unknown error" };
      results.push(result);
      onProgress?.(index + 1, conversationIds.length, result);
    }
  }

  return results;
}
