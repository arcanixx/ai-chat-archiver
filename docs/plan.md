# AI Chat Archiver — dokumentacja projektowa

## 1. Cel i zakres

Wtyczka Chrome/Edge (Manifest V3) do zapisywania rozmów z czatów AI do plików lokalnych w formatach Markdown / HTML / JSON, z poprawnym formatowaniem, rozwiniętymi sekcjami (Thinking, Code, Tool calls) i naprawą uszkodzonych bloków kodu. Pliki trafiają do konfigurowalnego podfolderu w `Downloads/`. Plik wynikowy ma być czytelny zarówno dla człowieka, jak i dla późniejszego agregatora AI.

## 2. Wspierani dostawcy (v1 → v2)

**MVP (v1):** ChatGPT, Claude, Gemini, DeepSeek
**v1.1:** Grok, Perplexity, Mistral (Le Chat), Kimi, Copilot

Każdy dostawca = osobny "adapter" w `src/adapters/<provider>.ts` z jednolitym interfejsem (patrz §6). Dzięki temu dodanie nowego dostawcy = jeden plik + wpis w rejestrze (zasada Open/Closed).

## 3. Stos technologiczny

- **Manifest V3** (wymóg sklepów Chrome/Edge)
- **TypeScript** (typy chronią przed regresjami w adapterach)
- **Vite + `@crxjs/vite-plugin`** — HMR, build wieloentry, automatyczny manifest
- **React + Tailwind** dla popupu i strony Options (mały bundle, znajome)
- **Zod** — walidacja ustawień i payloadów z adapterów
- **Turndown** — konwersja HTML → Markdown z customowymi regułami (code fences, listy, tabele, math)
- **DOMPurify** — sanityzacja przy zapisie HTML
- **highlight.js** (opcjonalnie, tylko w eksporcie HTML) — kolorowanie kodu
- **idb-keyval** — historia zapisów i kolejka batch w IndexedDB
- **Vitest** — testy jednostkowe adapterów na zapisanych fixture'ach HTML
- **ESLint + Prettier**

Brak backendu — wszystko lokalnie. Zero telemetrii bez zgody.

## 4. Architektura

```text
┌──────────────────────────────────────────────────────────┐
│  Popup (React)        Options page (React)               │
│   - Save now           - folder, format, naming pattern  │
│   - Batch URLs (≤30)   - per-provider toggles            │
│   - History            - logging level                   │
└─────────┬──────────────────────────┬─────────────────────┘
          │ messages                 │ chrome.storage.sync
          ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│  Service Worker (background.ts)                          │
│   - command/shortcut router                              │
│   - batch queue (open hidden tab → extract → close)      │
│   - chrome.downloads (subfolder, conflictAction)         │
│   - logger ring buffer (IndexedDB)                       │
└─────────┬────────────────────────────────────────────────┘
          │ scripting.executeScript / tab messages
          ▼
┌──────────────────────────────────────────────────────────┐
│  Content script (per provider, matched by host)          │
│   - inject floating "Save" button                        │
│   - adapter.expandAll() → adapter.extract() → normalize  │
│   - send Conversation JSON to SW                         │
└─────────┬────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────┐
│  Core (shared)                                           │
│   - Conversation model (typed)                           │
│   - serializers: md / html / json                        │
│   - code-fence repair, thinking blocks, tool calls       │
│   - filename builder (slugify + timestamp)               │
└──────────────────────────────────────────────────────────┘
```

## 5. Model danych (Conversation)

```ts
type Conversation = {
  schemaVersion: 1;
  provider: 'claude' | 'chatgpt' | 'gemini' | 'deepseek' | ...;
  providerModel?: string;        // np. "claude-sonnet-4.5" jeśli wykryte
  title: string;
  url: string;
  capturedAt: string;            // ISO
  messages: Message[];
  warnings: string[];            // np. "wykryto 2 niedomknięte bloki kodu"
};

type Message = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  createdAt?: string;
  parts: Part[];                 // kolejność zachowana
};

type Part =
  | { type: 'text'; markdown: string }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'thinking'; markdown: string; collapsedByDefault: true }
  | { type: 'tool_use'; name: string; input?: unknown }
  | { type: 'tool_result'; name: string; output: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'attachment'; name: string; mime?: string };
```

JSON to ten sam typ 1:1 — staje się formatem wymiany dla przyszłego agregatora.

## 6. Adapter dostawcy — interfejs

```ts
interface ProviderAdapter {
  id: string;
  match(url: URL): boolean;
  getTitle(doc: Document): string;
  detectModel?(doc: Document): string | undefined;
  /** Rozwija wszystkie zwinięte sekcje (Thinking, „Show more", code, artifacts).
   *  Czeka aż DOM się ustabilizuje (MutationObserver + debounce). */
  expandAll(doc: Document): Promise<void>;
  /** Zwraca uporządkowaną listę wiadomości. */
  extract(doc: Document): Message[];
}
```

Rejestr `adapters/index.ts` wybiera adapter po hoście. Każdy adapter ma fixture HTML (zapisaną realną rozmowę) i test snapshot dla `extract()`.

## 7. Kluczowe funkcje merytoryczne

### 7.1 Rozwijanie zwiniętych sekcji
- Przed ekstrakcją: scroll do końca (lazy-loaded wiadomości), potem `expandAll()` w pętli aż liczba klikalnych „Expand/Show more/Thinking" przestanie spadać (max N iteracji).
- Claude: rozwinięcie bloków „Thinking", „Artifacts", „Tool use".
- ChatGPT: „Continue generating" pomijamy; rozwinięcie „Reasoning" jeżeli widoczne.
- Gemini: „Show drafts", „Show thinking".
- DeepSeek/Kimi: panel „深度思考 / Thinking".

### 7.2 Naprawa bloków kodu
Częsty problem: model gubi otwierające/zamykające ``` lub kod wycieka poza fence.
- Ekstrakcja zawsze preferuje DOM-owe elementy `<pre><code class="language-xxx">` (są wiarygodne — to renderowany blok).
- Po stronie tekstu: walidator parzystości ``` per wiadomość; jeśli niedomknięte → dopisanie zamykającego fence + `warnings.push(...)`.
- Heurystyka „kod uciekł poza fence": linie zaczynające się od typowych tokenów (`import `, `def `, `function `, `<\?xml`, `SELECT `) graniczące z elementem `<code>` w DOM są scalane do bloku.

### 7.3 Batch z listy linków (≤30)
Pole tekstowe w popupie → jeden URL/linia. Service worker:
1. Walidacja (host musi pasować do znanego adaptera) i deduplikacja.
2. Kolejka z concurrency = 2 (konfigurowalne 1–4), backoff przy błędach.
3. `chrome.tabs.create({ url, active: false })` (ukryta zakładka). Po `tabs.onUpdated complete` + dodatkowy delay → wstrzyknięcie content scriptu, wywołanie extract, zamknięcie zakładki.
4. Postęp w popupie (live), per-URL status: pending/ok/failed + powód.
5. Cap 30 / batch (limit chroni przed rate-limitami dostawców).

### 7.4 Konwencja nazwy pliku
Szablon w Options (z domyślną wartością):
`{provider}/{YYYY-MM-DD}/{title}__{provider}__{YYYYMMDD-HHmmss}.{ext}`

- `title` slugify (NFKD, max 80 znaków, fallback `untitled`).
- Kolizja → `chrome.downloads` z `conflictAction: 'uniquify'`.
- Folder bazowy konfigurowalny (relatywny do `Downloads/`, MV3 nie pozwala na ścieżki absolutne bez File System Access).

### 7.5 Format Markdown
- Frontmatter YAML: `provider`, `model`, `title`, `url`, `captured_at`, `message_count`, `warnings`.
- Role jako nagłówki `## 🧑 User` / `## 🤖 Assistant` / `## 🧠 Thinking` (konfigurowalne).
- Code fences z językiem (z DOM-owej klasy `language-*`).
- Obrazy: domyślnie URL; opcja v1.1 — pobieranie do `assets/` obok pliku.

### 7.6 Format HTML
- Self-contained: inline CSS + opcjonalnie zaciągnięte highlight.js (offline kopia w bundle).
- Sanityzacja DOMPurify.
- Sekcje thinking jako `<details>` (zwinięte, ale obecne w treści — dla AI zawsze widoczne).

### 7.7 Format JSON
- 1:1 model z §5, `schemaVersion`, deterministyczne klucze (do diffowania).

## 8. UX / User-friendly

- **Floating button** w prawym dolnym rogu czatu (toggle w Options).
- **Popup**: Save now (dropdown formatu), Batch URLs textarea + licznik, ostatnie 10 zapisów z linkiem „Pokaż w folderze".
- **Skróty**: `Ctrl/Cmd+Shift+S` zapisz aktualny, `Ctrl/Cmd+Shift+B` otwórz batch.
- **Toast** w content scripcie po zapisie (sukces/błąd + liczba ostrzeżeń).
- **Badge** ikony pokazuje wykrytego dostawcę i liczbę wiadomości.
- **Options**: format domyślny, foldery, szablon nazwy, per-provider on/off, poziom logów, eksport/import ustawień.
- **Pierwsze uruchomienie**: krótki onboarding z listą wspieranych domen.
- **i18n**: PL + EN (struktura `_locales/`).
- **Accessibility**: focus trap w popupie, aria-labels, kontrast.

## 9. Logowanie i diagnostyka

- Logger z poziomami `debug|info|warn|error`, ring buffer (ostatnie 500 wpisów) w IndexedDB.
- Każda operacja zapisu: `{ traceId, provider, url, durationMs, partsCount, warnings, error? }`.
- Options → „Diagnostyka": podgląd logów, przycisk „Eksportuj logi" (JSON), „Wyczyść".
- Sentry/telemetria — **nie** domyślnie. Ewentualnie opt-in w przyszłości.
- W trybie dev: `console.group` z drzewem wiadomości.

## 10. Obsługa błędów (zdefiniowane klasy)

`AdapterNotFoundError`, `ExtractionEmptyError`, `LoginRequiredError` (wykrycie ekranu logowania w batch tabie), `RateLimitedError`, `DownloadBlockedError`. Każda mapowana na czytelny komunikat w toast/popupie + wpis do logu.

## 11. Uprawnienia (manifest)

Minimalny zestaw:
- `downloads` — zapis pliku
- `storage` — ustawienia + historia
- `scripting`, `activeTab` — wstrzykiwanie w aktywnej karcie
- `tabs` — batch (tworzenie/zamykanie ukrytych zakładek)
- `commands` — skróty klawiszowe
- `host_permissions`: tylko wspierane domeny (`https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`, `https://chat.deepseek.com/*`, itd.)

Bez `<all_urls>` → łatwiejsze review w Chrome Web Store.

## 12. Bezpieczeństwo i prywatność

- Treści rozmów **nigdy** nie opuszczają urządzenia.
- DOMPurify przy serializacji HTML (rozmowy bywają wektorem XSS).
- CSP w manifeście domyślne MV3 (no remote code).
- Polityka prywatności w README + na stronie Options (wymóg sklepów).

## 13. Testy

- Vitest: dla każdego adaptera 2–3 zapisane snapshoty HTML (krótka rozmowa, długa z code, rozmowa z thinking + tools).
- Testy serializerów (round-trip JSON ↔ MD ↔ JSON gdzie możliwe).
- Test naprawy fence (zestaw uszkodzonych przypadków).
- Smoke test E2E przez Playwright (opcjonalnie, na fixture HTML serwowanych lokalnie).

## 14. Plan dostarczenia

**MVP (v1.0)**
1. Szkielet projektu (Vite + crxjs + TS + Tailwind), manifest, popup, options.
2. Core: model, serializery MD/HTML/JSON, filename builder, logger.
3. Adapter Claude (najbogatszy DOM — thinking, artifacts) + fixture + testy.
4. Adapter ChatGPT, Gemini, DeepSeek.
5. Floating button + skrót + zapis pojedynczy.
6. Batch URLs (do 30, ukryte zakładki, kolejka).
7. Naprawa code fences, ostrzeżenia.
8. Options (folder, format, szablon, per-provider).
9. Diagnostyka i eksport logów.
10. README + polityka prywatności + ikony + paczka ZIP.

**v1.1**
- Grok, Perplexity, Mistral, Kimi, Copilot.
- Pobieranie obrazów do `assets/`.
- Auto-snapshot przy zamknięciu karty (opcjonalny).
- i18n EN.

**v2 (do dyskusji)**
- Auto-zapis po każdej odpowiedzi (MutationObserver per adapter).
- Integracja z agregatorem (lokalny index + wyszukiwarka po zapisanych plikach).
- File System Access API jako alternatywa dla `chrome.downloads`.

## 15. Pytania otwarte (do potwierdzenia przed Buildem)

1. Czy chcesz, żebym od razu w MVP dodał adapter Grok/Perplexity, czy zostawiamy zgodnie z propozycją na v1.1?
2. Załączysz przykładowe HTML-e (Claude, ChatGPT, Gemini, DeepSeek)? Bardzo przyspieszy to napisanie selektorów — bez nich oprę się na publicznej strukturze i fixture'ach z internetu, ale ryzyko regresji rośnie.
3. Czy nazwa pliku ma być w pełni konfigurowalnym szablonem (tokeny `{provider} {title} {date} {time} {model}`), czy wystarczy 2–3 presety?
4. Domyślny format zapisu przy skrócie klawiszowym: MD, HTML, JSON, czy „wszystkie trzy naraz"?

Po zatwierdzeniu planu przechodzimy do Build i zaczynam od szkieletu + adaptera Claude (referencyjny, najtrudniejszy DOM).

