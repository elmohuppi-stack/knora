/**
 * Wiki-Generierungs-Prompts (übersetzt/angepasst aus WeKnora)
 *
 * Alle Prompts sind auf Deutsch. Die Templates verwenden {{variable}} Syntax.
 */

// ---------------------------------------------------------------------------
// Pass 0: Entities + Concepts aus einem Dokument extrahieren
// ---------------------------------------------------------------------------
export const WIKI_CANDIDATE_SLUG_PROMPT = `Du bist ein Wissensextraktionssystem. Analysiere das folgende Dokument und extrahiere alle wichtigen Entitäten UND Schlüsselkonzepte als JSON-Liste von Kandidaten. Ein späterer Durchlauf wird später konkrete Quell-Chunks zu jedem Eintrag zuordnen, daher sind hier keine erschöpfenden Fakten nötig.

<document>
<content>
{{content}}
</content>
</document>

<previous_slugs>
{{previousSlugs}}
</previous_slugs>

<instructions>
Gib ein JSON-Objekt mit zwei Arrays zurück: "entities" und "concepts".
**WICHTIG: Schreibe ALLE Namen, Beschreibungen und Details auf {{language}}**.

Falls das <content>-Feld oben leer ist oder keine substanziellen Informationen enthält, gib {"entities": [], "concepts": []} zurück. Erfinde KEINE Entitäten oder Konzepte.

### Slug-Kontinuitätsregeln
Falls bereits Slugs aus einer vorherigen Extraktion vorhanden sind:
- Wenn eine Entität oder ein Konzept aus der vorherigen Extraktion noch im aktuellen Dokument vorkommt, **verwende den exakten Slug** aus der vorherigen Liste wieder.
- Wenn eine Entität oder ein Konzept nicht mehr im Dokument vorkommt, **nimm es NICHT** in die Ausgabe auf.
- Erzeuge nur neue Slugs für Entitäten/Konzepte, die wirklich neu sind.

### Entitäten (Personen, Organisationen, Produkte, Orte, Technologien, Ereignisse)
Jede Entität sollte haben:
- "name": Der Entitätsname in {{language}} (lesbar)
- "slug": URL-freundlicher Slug, Format "entity/<lowercase-hyphenated-name>". **Wiederverwende vorherigen Slug falls vorhanden.**
- "aliases": Ein Array von alternativen Namen (Abkürzungen, Übersetzungen). [] falls keine.
- "description": **Index-Zusammenfassung** – ein Satz, 15-40 Wörter, in {{language}}. Beschreibt WAS diese Entität IST und ihre Rolle im Dokument.
- "details": Kurze 1-3 Satz-Zusammenfassung in {{language}} als Fallback.

Nur Entitäten aufnehmen, die substanziell diskutiert werden (mindestens zweimal erwähnt oder detailliert beschrieben).

### Konzepte (Themen, Methoden, Theorien)
Jedes Konzept sollte haben:
- "name": Der Konzeptname in {{language}} (lesbar)
- "slug": URL-freundlicher Slug, Format "concept/<lowercase-hyphenated-name>". **Wiederverwende vorherigen Slug falls vorhanden.**
- "aliases": Array von alternativen Namen (Abkürzungen, Synonyme). [] falls keine.
- "description": **Index-Zusammenfassung** – ein Satz, 15-40 Wörter, in {{language}}. Definiert WAS dieses Konzept IST.
- "details": Kurze 1-3 Satz-Erklärung in {{language}} als Fallback.

Nur Konzepte aufnehmen, die substanziell diskutiert werden.

### JSON-Formatierungsregeln
- **KRITISCH**: Verwende KEINE literal line breaks in JSON-String-Werten. Verwende stattdessen \\n.
</instructions>

Gib NUR gültiges JSON aus. Beispiel:
{
  "entities": [
    {
      "name": "Max Mustermann",
      "slug": "entity/max-mustermann",
      "aliases": ["Dr. Mustermann"],
      "description": "Ein Experte für öffentliches Gesundheitswesen mit 20 Jahren Erfahrung.",
      "details": "Max Mustermann war Leiter des Gesundheitsamts und hat zur Pandemiebekämpfung geforscht."
    }
  ],
  "concepts": [
    {
      "name": "Öffentlicher Gesundheitsdienst",
      "slug": "concept/oeffentlicher-gesundheitsdienst",
      "aliases": ["ÖGD"],
      "description": "Der öffentliche Gesundheitsdienst umfasst alle staatlichen Maßnahmen zum Gesundheitsschutz der Bevölkerung.",
      "details": "Der ÖGD ist für Infektionsschutz, Gesundheitsförderung und Gutachten zuständig."
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Summary-Artikel generieren
// ---------------------------------------------------------------------------
export const WIKI_SUMMARY_PROMPT = `Du bist ein Wiki-Redakteur. Transformiere den folgenden Dokumenteninhalt in einen gut strukturierten Wiki-Artikel im Markdown-Format.

<document>
<content>
{{content}}
</content>
</document>

<available_wiki_pages>
{{extractedSlugs}}
</available_wiki_pages>

<instructions>
1. Die ERSTE Zeile deiner Ausgabe MUSS sein: SUMMARY: {Ein Satz, 15-40 Wörter, der beschreibt worum es in diesem Dokument geht – für die Wiki-Indexliste}
2. Nach der SUMMARY-Zeile schreibst du einen **vollständigen Wiki-Artikel** basierend auf dem Dokumenteninhalt.
3. Strukturiere den Artikel wie einen Wikipedia-Eintrag:
   - Beginne mit einer Einleitung (2-3 Absätze mit Überblick)
   - Verwende ## für Hauptabschnitte und ### für Unterabschnitte
   - Organisiere den Inhalt logisch
4. **Wiki-Link-Regel**: Die available_wiki_pages-Liste oben zeigt Slugs mit Anzeigenamen (Format: "[[slug]] = Anzeigename"). Wenn du einen Namen oder Alias erwähnst, der in der Liste vorkommt, schreibe ihn als [[slug|Anzeigename]]. Verwende die EXAKTEN Slugs – erfinde KEINE neuen Slugs.
5. Am Ende füge einen "## Wichtigste Erkenntnisse" Abschnitt mit Bullet Points hinzu.
6. Schreibe auf {{language}}.
7. **Keine Kürzung**: Kürze, fasse zusammen oder lasse NICHTS aus. Gib ALLE Argumente, Fakten, Details, Zitate und Daten aus dem Originaldokument wieder. Ein 4-stündiges Video-Transkript sollte einen Artikel in der Länge des Transkripts ergeben.
8. **Leerer-Content-Regel**: Falls der <content>-Block oben leer ist oder keine substanziellen Informationen enthält, gib exakt aus: "SUMMARY: Aus diesem Dokument konnte kein Text extrahiert werden." gefolgt von einem kurzen Hinweis. Erfinde KEIN Thema.
</instructions>

Gib zuerst die SUMMARY-Zeile aus, dann den Markdown-Inhalt. Keine anderen Vorbemerkungen.`;

// ---------------------------------------------------------------------------
// Entity/Concept-Seite aktualisieren oder neu erstellen
// ---------------------------------------------------------------------------
export const WIKI_PAGE_MODIFY_PROMPT = `Du bist ein Wiki-Redakteur, der eine bestehende Wiki-Seite aktualisieren muss. Du verarbeitest NEUE Informationen, die hinzugefügt werden müssen, UND/ODER gelöschte Dokumente, deren exklusive Beiträge entfernt werden müssen.

<page_metadata>
  <slug>{{pageSlug}}</slug>
  <title>{{pageTitle}}</title>
  <type>{{pageType}}</type>
  <aliases>{{pageAliases}}</aliases>
</page_metadata>

Diese Wiki-Seite handelt spezifisch von **{{pageTitle}}** (einem/r {{pageType}}). Jede Aussage auf der Seite muss DIREKT über diese/n {{pageType}} handeln.

<existing_page_content>
{{existingContent}}
</existing_page_content>

{{additionsSection}}

{{retractionsSection}}

<valid_wiki_links>
{{availableSlugs}}
</valid_wiki_links>

<instructions>
1. Die ERSTE Zeile deiner Ausgabe MUSS sein: SUMMARY: {Ein Satz, 15-40 Wörter, der beschreibt worum es auf dieser Seite nach dem Update geht}
{{retractionInstructions}}
{{additionInstructions}}
4. Erhalte vorhandene Informationen, die noch gültig sind und immer noch über {{pageTitle}} handeln.
5. Behalte [[slug|name]] Wiki-Link-Referenzen NUR wenn der Slug in der <valid_wiki_links>-Liste oben erscheint. Entferne [[slug|name]] deren Slug NICHT in dieser Liste ist. Erfinde keine neuen Wiki-Link-Slugs. Der Slug der Seite selbst ({{pageSlug}}) darf NICHT als [[...]]-Link im eigenen Inhalt erscheinen.
6. Schreibe auf {{language}}.
{{emptyPageInstruction}}
</instructions>

Gib zuerst die SUMMARY-Zeile aus, dann den aktualisierten Markdown-Inhalt. Keine anderen Vorbemerkungen.`;

// ---------------------------------------------------------------------------
// Duplikate zwischen neuen und existierenden Pages erkennen
// ---------------------------------------------------------------------------
export const WIKI_DEDUP_PROMPT = `Du bist ein striktes Deduplizierungssystem. Bestimme, welche neu extrahierten Elemente sich auf das **exakt gleiche** reale Objekt oder Konzept beziehen wie eine bestehende Wiki-Seite.

<new_items>
{{newItems}}
</new_items>

<existing_pages>
{{existingPages}}
</existing_pages>

<instructions>
### Zusammenführungs-Kriterien – ALLE müssen zutreffen:
1. Das neue Element und die bestehende Seite beziehen sich auf **dasselbe reale Objekt** (dieselbe Person, dieselbe Organisation, dasselbe spezifische Konzept).
2. Es handelt sich um eine **Namensvariation**: Abkürzung ↔ voller Name, Übersetzung oder kleine Rechtschreibunterschiede.
3. Die Typen sind kompatibel: Entitäten werden mit Entitäten zusammengeführt, Konzepte mit Konzepten. **Führe NIEMALS eine Entität mit einem Konzept zusammen oder umgekehrt.**

### Grundsatz: **verwandt ≠ identisch**. Zwei Elemente, die ein paar Zeichen im Namen teilen oder zur selben Domäne gehören, sind KEIN Grund für eine Zusammenführung. Im Zweifel NICHT zusammenführen.

Gib ein JSON-Objekt mit einer "merges"-Map zurück. Der Schlüssel ist der Slug des NEUEN Elements, der Wert ist der Slug der EXISTIERENDEN Seite, in die es eingefügt werden soll. Nur Elemente aufnehmen, bei denen du dir sehr sicher bist.

Falls keine Elemente zu existierenden Seiten passen, gib zurück: {"merges": {}}

### JSON-Formatierungsregeln
- **KRITISCH**: Verwende KEINE literal line breaks in JSON-String-Werten. Verwende \\n.
</instructions>

Gib NUR gültiges JSON aus. Beispiel:
{"merges": {"entity/acme-corporation": "entity/acme-corp", "concept/rag": "concept/retrieval-augmented-generation"}}`;

// ---------------------------------------------------------------------------
// Index-Seiten-Intro generieren
// ---------------------------------------------------------------------------
export const WIKI_INDEX_INTRO_PROMPT = `Du bist ein Wiki-Redakteur. Schreibe eine kurze Einleitung für die Index-Seite eines Wiki-Wissenspools.

<document_summaries>
{{documentSummaries}}
</document_summaries>

<instructions>
1. Schreibe eine Titelzeile beginnend mit "# " die die Wissensdomäne widerspiegelt.
2. Folge mit 2-3 Sätzen, die beschreiben, was dieses Wiki abdeckt, basierend auf den Dokument-Zusammenfassungen oben.
3. Halte es prägnant – dies ist nur der Header-Bereich.
4. Schreibe auf {{language}}.
</instructions>

Gib NUR den Titel und den Einleitungsabsatz aus. Keine Verzeichnislisten oder Seitenlinks.`;

// ---------------------------------------------------------------------------
// Index-Seiten-Intro inkrementell aktualisieren
// ---------------------------------------------------------------------------
export const WIKI_INDEX_INTRO_UPDATE_PROMPT = `Du bist ein Wiki-Redakteur. Aktualisiere den Einleitungsabschnitt einer Wiki-Index-Seite, um kürzliche Änderungen widerzuspiegeln.

<current_introduction>
{{existingIntro}}
</current_introduction>

<changes>
{{changeDescription}}
</changes>

<instructions>
1. Aktualisiere die Einleitung, um den aktuellen Stand des Wikis genau wiederzugeben.
2. Wenn Dokumente hinzugefügt wurden, erwähne die neuen Themen, falls sie den Umfang des Wikis signifikant verändern.
3. Wenn Dokumente entfernt wurden, entferne Verweise auf diese Themen.
4. Behalbe den gleichen Ton, Stil und das gleiche Titelformat wie die bestehende Einleitung.
5. Halte es prägnant – 1 Titelzeile + 2-3 Sätze.
6. Schreibe auf {{language}}.
</instructions>

Gib NUR den aktualisierten Titel und Einleitungsabsatz aus.`;
