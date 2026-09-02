# APP_Releasy

Azure DevOps Release Overview Application

## Description

**Releasy** je webová aplikace pro správu a přehled release verzí v Azure DevOps. Aplikace poskytuje hierarchický přehled work items (Features a Bugs) organizovaných podle produktů, release verzí, major verzí a patch verzí. Umožňuje jak zobrazení dat (read-only), tak i jejich úpravu (read-write) přímo z rozhraní aplikace.

## Hlavní funkce

### Read-Only funkce (základní režim)
- 📊 **Hierarchický přehled** - Zobrazení work items podle produktu → release → major verze → patch verze
- 🔵 **Stav child tasků** - Barevné tečky vlevo od statusu Bugu/Feature podle stavu podřízených úkolů (nejvýše 6, poměrně podle počtu ve statusu, minimálně 1 tečka na status; hover ukáže všechny názvy, assignee a statusy, klik otevře detail tasku). U názvu jedno unikátní barevné písmeno prefixu (D, X, I, A, U, T, C, K, O) pro každý typ tasku, který ještě není celý Closed (tooltip: Open DEV tasks (2))
- 📈 **Progress bary** - Vizuální indikátory průběhu podle statusů (Closed, Resolved, Active, New, Evaluation)
- 🔍 **Filtrování** - Filtrování work items podle assignee a statusu
- 🔎 **Fulltextové hledání** - Hledání v gridu podle ID a názvu work itemů
- 👁️ **Detail work itemu** - Zobrazení detailních informací včetně popisu a komentářů
- 📋 **Kopírování** - Zkopírování názvu nebo odkazu na work item do schránky
- 🔀 **Build Changes** - Přehled změn v buildu pro patch verze s namapovanou pipeline
- 📄 **Export do Markdown** - Export patch verzí do Markdown dokumentu
- 🎨 **Témata** - Světlý režim, tmavý režim a automatický režim podle nastavení systému
- 🔄 **Reload dat** - Aktualizace dat z Azure DevOps včetně informace o posledním načtení
- 👁️ **Skrývání verzí** - Možnost skrýt major nebo patch verze pro lepší přehled
- 📂 **Expand All / Collapse All** - Expand All rozbalí major i patch verze aktuálního produktu, takže jsou vidět Bugs a Features; Collapse All sbalí jen aktuální produkt. Stav rozbalení se pamatuje per produkt v localStorage.

### Read-Write funkce (rozšířený režim)
Všechny read-only funkce plus:
- ➕ **Vytváření work items** - Vytváření nových Features a Bugs; u popisu lze přepínačem zvolit,
  zda se má zapsat jako HTML (výchozí grafický editor) nebo jako Markdown
- 📝 **Vytváření child tasks** - Vytváření podřízených úkolů; stejný přepínač formátu popisu jako u
  Features/Bugs
- ✏️ **Úprava work items** - Editace názvu a popisu work itemů; popis podporuje jak formát HTML
  (výchozí grafický editor), tak Markdown - aplikace automaticky pozná, v jakém formátu je popis
  daného work itemu uložený v Azure DevOps, a nabídne odpovídající editor. U popisu ve formátu HTML
  lze přepínačem převést na Markdown - obsah se skutečně převede do Markdown syntaxe (přes knihovnu
  Turndown), aby se v editoru nezobrazoval syrový HTML kód. Opačný směr (Markdown → HTML) není
  možný, Azure DevOps to nedovoluje - přepínač na HTML je proto po uložení/detekci Markdownu
  zablokovaný
- 💬 **Nový komentář** - Přidání nového komentáře k work itemu z detailu; formát lze přepnout mezi
  Markdown (výchozí) a HTML stejným přepínačem a editorem jako u popisu. Existující komentáře
  zůstávají needitovatelné a nelze je smazat
- 🔄 **Změna statusu** - Rychlá změna statusu work itemů
- 🏷️ **Změna priority** - Úprava priority work items
- ⚠️ **Změna severity** - Úprava severity u Bugů
- 👤 **Změna assignee** - Přiřazení work itemů k uživatelům
- 🔀 **Změna patch verze** - Přesunutí work itemů mezi patch verzemi
- 📋 **Task Mode** - Zobrazení a správa child tasks

## Požadavky

- Moderní webový prohlížeč (Chrome, Firefox, Edge, Safari)
- Připojení k internetu - knihovny (Vue, Bootstrap, Font Awesome, marked.js, Turndown) se načítají
  z CDN
- Azure DevOps účet s přístupem k projektu
- Personal Access Token (PAT) s příslušnými oprávněními:
  - **Read-Only režim**: `Work Items: Read`
  - **Read-Write režim**: `Work Items: Read & Write`

## Instalace a spuštění

### Lokální spuštění

1. Naklonujte nebo stáhněte tento repozitář
2. Otevřete soubor `index.html` v webovém prohlížeči
3. Při prvním spuštění zadejte svůj Azure DevOps Personal Access Token

Aplikace nepotřebuje žádný build step - `index.html` je kompletní aplikace včetně Vue komponent.
Pro načtení lokální kopie uživatelské příručky (`guide.html`) je vhodné soubory naservírovat přes
HTTP, protože prohlížeče blokují `fetch` z protokolu `file://`:

```bash
python3 -m http.server 8000
# aplikace pak běží na http://localhost:8000/index.html
```

### Nasazení na server

Aplikace je čistě klientská (client-side) aplikace, která může být nasazena na jakýkoliv webový server:
- Stačí nahrát všechny soubory na server
- Aplikace funguje bez nutnosti backend serveru
- Všechna data se ukládají lokálně v prohlížeči (localStorage)

## Konfigurace

### Personal Access Token (PAT)

1. Přejděte do Azure DevOps → User Settings → Personal Access Tokens
2. Vytvořte nový token s požadovaným scope:
   - Pro read-only: `Work Items: Read`
   - Pro read-write: `Work Items: Read & Write`
3. Zkopírujte token a při prvním spuštění aplikace ho zadejte
4. Vyberte odpovídající úroveň oprávnění (Read-Only nebo Read-Write)
5. Token je uložen lokálně v prohlížeči a není odesílán na žádný server kromě Azure DevOps API

### Změna PAT

Klikněte na ikonu klíče (🔑) vedle permission badge pro otevření modalu a zadání nového tokenu.

## Struktura projektu

```
APP_Releasy/
├── index.html          # Hlavní aplikace (single-page application)
├── guide.html          # Uživatelská příručka (načítá se dynamicky)
├── logo_dark.png       # Logo pro tmavý režim
├── logo_light.png      # Logo pro světlý režim
├── ARCHITECTURE.md     # Technická mapa aplikace (pro vývoj a AI asistenty)
├── AGENTS.md           # Pravidla a vstupní bod pro AI asistenty
├── dev.env             # PAT pro lokální testování (v .gitignore, nikdy se necommituje)
└── README.md           # Tento soubor
```

## Technologie

- **HTML5** - Struktura aplikace
- **CSS3** - Stylování s CSS proměnnými pro theming
- **Vue 3.5.13** - Reaktivní vykreslování a stav aplikace, načtený z CDN (global build s runtime
  kompilátorem, takže aplikace zůstává jediný soubor bez build stepu)
- **Bootstrap 5.3.0** - UI komponenty a grid systém
- **Font Awesome 6.5.0** - Ikony
- **marked.js 18.0.9** - Vykreslení Markdown popisu work itemu do náhledu (pouze pro popisy, které
  jsou v Azure DevOps uložené ve formátu Markdown)
- **Turndown 7.2.4** - Převod HTML popisu na Markdown syntaxi při přepnutí formátu popisu z HTML na
  Markdown (v detailu work itemu i v zakládacích formulářích)
- **Web Crypto API** - Šifrování Personal Access Tokenu (AES-GCM) před uložením do localStorage
- **Azure DevOps REST API** - Komunikace s Azure DevOps

## Architektura

Aplikace je postavená na Vue 3, ale zůstává jediným HTML souborem - žádný bundler ani build step:

- **Reaktivní store** - Centrální stav aplikace (data z Azure DevOps, filtry, hledání, rozbalené
  sekce, skryté verze, téma, stav všech modalů) je jeden reaktivní objekt. Odvozená data jako
  filtrovaný strom work itemů jsou computed properties.
- **Komponenty** - Šablony jsou definované jako `<script type="text/x-template">` bloky:
  `ReleasyGrid`, `PatchSection`, `WorkItemRow`, `ProgressBar`, `PriorityCell`, `HtmlEditor`
  (sdílený editor popisu pro detail i zakládací formuláře) a `MarkdownEditor` (obdoba `HtmlEditor`
  pro Markdown popisy) - v detailu work itemu se volí automaticky podle formátu uloženého v Azure
  DevOps, v zakládacích formulářích (Feature/Bug/Task) si formát vybírá uživatel přepínačem.
- **Vue aplikace** - Vue je připojené na několik nezávislých kořenů (grid, toolbar, filtry,
  notifikace, přepínač témat, hlavička, footer a jednotlivé modaly).
- **Generický picker** - Změna statusu, priority, severity, assignee a patch verze používá jednu
  společnou komponentu místo šesti duplikovaných modalů.
- **Persistence** - Ukládání preferencí do localStorage řeší `watch` nad store, takže se stav
  synchronizuje automaticky bez ručních volání.

## Zobrazené work items

Aplikace zobrazuje pouze work items, které splňují následující kritéria:
- **Typ**: Pouze `Feature` a `Bug` (Tasks se zobrazují pouze jako child tasks v Task Mode)
- **Platform Release**: Musí mít vyplněné pole `Custom.PlatformRelease` s odpovídající verzí (např. "Labe-07.006")
- **Status**: 
  - Všechny statusy kromě `Removed`
  - Work items se statusem `Closed` jsou zobrazeny pouze pokud byly uzavřeny v posledních **180 dnech**

## Hierarchie zobrazení

Aplikace organizuje work items do 4 úrovní:
1. **Level 1**: Produkt - Release (např. "Xeelo - Labe")
2. **Level 2**: Major Version (např. "Labe-07")
3. **Level 3**: Patch Version (např. "Labe-07.005")
4. **Level 4**: Work Items (Features a Bugs)

## Ukládání preferencí

Aplikace automaticky ukládá následující preference do localStorage:
- Rozbalené/sbalené sekce (zvlášť pro každý produkt)
- Skryté verze
- Aktivní filtry
- Task Mode stav
- Naposledy vybraný produkt (záložka)
- Čas posledního načtení dat
- Vybrané téma (světlé/tmavé/automatické)
- Úroveň oprávnění tokenu (read-only / read-write)
- Personal Access Token (šifrovaný pomocí AES-GCM)

## Dokumentace

Podrobná uživatelská příručka je dostupná přímo v aplikaci:
- Klikněte na ikonu nápovědy (❓) v hlavním rozhraní
- Příručka obsahuje detailní popis všech funkcí a možností
- Přednostně se načítá lokální `guide.html`; pokud není dostupný, aplikace ji stáhne z asset
  služby Integray

## Bezpečnost

- Personal Access Token je uložen pouze lokálně v prohlížeči a je šifrovaný (AES-GCM)
- Token není odesílán na žádný server kromě Azure DevOps API
- Všechna komunikace probíhá přes HTTPS
- Aplikace neukládá žádná citlivá data na externí servery

## Podpora

Pro podporu a dotazy kontaktujte vývojový tým nebo se podívejte do uživatelské příručky v aplikaci.

## Licence

Tento projekt je interní aplikace společnosti Integray.

