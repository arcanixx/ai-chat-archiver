import type { RuntimeMessage } from "../core/types";
export function toast(text: string, kind: "ok" | "err" = "ok") {
  const existing = document.querySelector(".ai-archiver-toast");
  if (existing) existing.remove();
  
  const t = document.createElement("div");
  t.className = `ai-archiver-toast ai-archiver-toast-${kind}`;
  t.textContent = text;
  document.body.appendChild(t);
  
  requestAnimationFrame(() => t.classList.add("show"));
  
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

export async function injectFloatingButton(onSave: () => void, onSaveSelection: () => void) {
  const FLOAT_BTN_ID = "ai-archiver-float-btn";
  if (document.getElementById(FLOAT_BTN_ID)) return;
  
  const btn = document.createElement("button");
  btn.id = FLOAT_BTN_ID;
  btn.title = "Save chat (Ctrl+Shift+S) | Save selection (Ctrl+Shift+X)";
  // Use SVG for perfectly centered icon
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
      <polyline points="17 21 17 13 7 13 7 21"></polyline>
      <polyline points="7 3 7 8 15 8"></polyline>
    </svg>
  `;
  btn.style.position = "fixed";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.width = "36px";
  btn.style.height = "36px";
  btn.style.background = "rgba(30,30,30,0.85)";
  btn.style.border = "2px solid rgba(255,255,255,0.3)";
  btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.4)";
  btn.style.right = "20px";
  btn.style.bottom = "20px";
  btn.style.color = "#fff";
  btn.style.cursor = "pointer";
  btn.style.zIndex = "2147483647";
  btn.style.setProperty("z-index", "2147483647", "important");
  btn.setAttribute("draggable", "true");
  
  try {
    const { floatingButtonPosition } = await chrome.storage.sync.get("floatingButtonPosition");
    if (floatingButtonPosition) {
      btn.style.right = "auto";
      btn.style.bottom = "auto";
      btn.style.left = `${floatingButtonPosition.x}px`;
      btn.style.top = `${floatingButtonPosition.y}px`;
    }
  } catch {}
  
  const style = document.createElement("style");
  style.textContent = `
    .ai-archiver-toast { position: fixed; bottom: 20px; left: 20px; padding: 10px 20px; border-radius: 4px; color: white; opacity: 0; transition: opacity 0.3s; z-index: 10000; }
    .ai-archiver-toast-ok { background: #4caf50; }
    .ai-archiver-toast-err { background: #f44336; }
    .ai-archiver-toast.show { opacity: 1; }
    #ai-archiver-float-btn:hover { background: rgba(50,50,50,0.95) !important; transform: scale(1.05); }
    #ai-archiver-float-btn.loading { opacity: 0.6; pointer-events: none; }
  `;
  document.head.appendChild(style);
  

  let isDragging = false;
  let dragOccurred = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  // Click handler: if there's a text selection, save as snippet; otherwise save full conversation
  // Ignores clicks that followed a drag (dragOccurred)
  btn.addEventListener("click", async (e) => {
    if (e.button !== 0 || btn.classList.contains("loading") || dragOccurred) {
      dragOccurred = false;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    
    // Check if user has text selected
    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount > 0 && selection.toString().trim().length >= 3;
    
    btn.classList.add("loading");
    try {
      if (hasSelection) {
        await onSaveSelection();
        toast("Snippet saved", "ok");
      } else {
        await onSave();
        toast("Conversation saved", "ok");
      }
    } catch (err) {
      console.error(err);
      toast(`Error: ${(err as any).message || "save failed"}`, "err");
    } finally {
      btn.classList.remove("loading");
    }
  });
  
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSaveSelection();
  });
  
  btn.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDragging = false;
    // dragOccurred is NOT reset here — it stays true until after the click event would fire
    startX = e.clientX;
    startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    
    const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Mark as dragging when movement exceeds a small threshold
        if (!isDragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          isDragging = true;
          dragOccurred = true;
        }
        btn.style.right = "auto";
        btn.style.bottom = "auto";
        btn.style.left = `${startLeft + dx}px`;
        btn.style.top = `${startTop + dy}px`;
      };
    
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (isDragging) {
        const rect = btn.getBoundingClientRect();
        chrome.storage.sync.set({
          floatingButtonPosition: { x: rect.left, y: rect.top }
        });
        // Clear drag flag so next click is not ignored
        dragOccurred = false;
      }
      isDragging = false;
    };
    
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  
  document.body.appendChild(btn);
}
