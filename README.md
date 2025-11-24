# APP_Releasy

Azure DevOps Release Overview Application

## Description

**Releasy** je webová aplikace pro správu a přehled release verzí v Azure DevOps. Aplikace poskytuje hierarchický přehled work items (Features a Bugs) organizovaných podle produktů, release verzí, major verzí a patch verzí. Umožňuje jak zobrazení dat (read-only), tak i jejich úpravu (read-write) přímo z rozhraní aplikace.

## Hlavní funkce

### Read-Only funkce (základní režim)
- 📊 **Hierarchický přehled** - Zobrazení work items podle produktu → release → major verze → patch verze
- 📈 **Progress bary** - Vizuální indikátory průběhu podle statusů (Closed, Resolved, Active, New, Evaluation)
- 🔍 **Filtrování** - Filtrování work items podle assignee a statusu
- 👁️ **Detail work itemu** - Zobrazení detailních informací včetně popisu
- 📄 **Export do PDF** - Export patch verzí do PDF dokumentu
- 🎨 **Témata** - Podpora světlého a tmavého režimu
- 🔄 **Reload dat** - Aktualizace dat z Azure DevOps
- 👁️ **Skrývání verzí** - Možnost skrýt major nebo patch verze pro lepší přehled

### Read-Write funkce (rozšířený režim)
Všechny read-only funkce plus:
- ➕ **Vytváření work items** - Vytváření nových Features a Bugs
- 📝 **Vytváření child tasks** - Vytváření podřízených úkolů
- ✏️ **Úprava work items** - Editace názvu a popisu work itemů
- 🔄 **Změna statusu** - Rychlá změna statusu work itemů
- 🏷️ **Změna priority** - Úprava priority work items
- ⚠️ **Změna severity** - Úprava severity u Bugů
- 👤 **Změna assignee** - Přiřazení work itemů k uživatelům
- 🔀 **Změna patch verze** - Přesunutí work itemů mezi patch verzemi
- 📋 **Task Mode** - Zobrazení a správa child tasks

## Požadavky

- Moderní webový prohlížeč (Chrome, Firefox, Edge, Safari)
- Azure DevOps účet s přístupem k projektu
- Personal Access Token (PAT) s příslušnými oprávněními:
  - **Read-Only režim**: `Work Items: Read`
  - **Read-Write režim**: `Work Items: Read & Write`

## Instalace a spuštění

### Lokální spuštění

1. Naklonujte nebo stáhněte tento repozitář
2. Otevřete soubor `index.html` v webovém prohlížeči
3. Při prvním spuštění zadejte svůj Azure DevOps Personal Access Token

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
└── README.md           # Tento soubor
```

## Technologie

- **HTML5** - Struktura aplikace
- **CSS3** - Stylování s CSS proměnnými pro theming
- **Vanilla JavaScript** - Veškerá logika aplikace (bez frameworků)
- **Bootstrap 5.3.0** - UI komponenty a grid systém
- **Font Awesome 6.5.0** - Ikony
- **jsPDF 2.5.1** - Generování PDF dokumentů
- **Azure DevOps REST API** - Komunikace s Azure DevOps

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
- Rozbalené/sbalené sekce
- Skryté verze
- Aktivní filtry
- Task Mode stav
- Vybrané téma (světlé/tmavé)
- Personal Access Token (šifrovaný)

## Dokumentace

Podrobná uživatelská příručka je dostupná přímo v aplikaci:
- Klikněte na ikonu nápovědy (❓) v hlavním rozhraní
- Příručka obsahuje detailní popis všech funkcí a možností

## Bezpečnost

- Personal Access Token je uložen pouze lokálně v prohlížeči
- Token není odesílán na žádný server kromě Azure DevOps API
- Všechna komunikace probíhá přes HTTPS
- Aplikace neukládá žádná citlivá data na externí servery

## Podpora

Pro podporu a dotazy kontaktujte vývojový tým nebo se podívejte do uživatelské příručky v aplikaci.

## Licence

Tento projekt je interní aplikace společnosti Integray.

