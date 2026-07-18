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

{{granularityGuidance}}

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

Wende die Extraktions-Umfang-Regeln oben an. Befördere niemals nur beiläufig erwähnte Namen zu Entitäten.

### Konzepte (Themen, Methoden, Theorien)
Jedes Konzept sollte haben:
- "name": Der Konzeptname in {{language}} (lesbar)
- "slug": URL-freundlicher Slug, Format "concept/<lowercase-hyphenated-name>". **Wiederverwende vorherigen Slug falls vorhanden.**
- "aliases": Array von alternativen Namen (Abkürzungen, Synonyme). [] falls keine.
- "description": **Index-Zusammenfassung** – ein Satz, 15-40 Wörter, in {{language}}. Definiert WAS dieses Konzept IST.
- "details": Kurze 1-3 Satz-Erklärung in {{language}} als Fallback.

Wende die Extraktions-Umfang-Regeln oben an. Überspringe Konzepte, die nur namentlich erwähnt, aber nicht diskutiert werden.

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
export const WIKI_PAGE_MODIFY_PROMPT = `Du bist ein Wiki-Redakteur, der eine Wiki-Seite erstellt oder aktualisiert. Du bist ein KOMPILIERER, kein freier Autor: Du verdichtest die gelieferten Quell-Chunks zu einem vollständigen, gut gegliederten Artikel – ohne Fakten zu erfinden und ohne welche wegzulassen.

### Zitat- und Kompilierungs-Regeln (KRITISCH):
- **Alle Fakten verwenden**: Der <new_information>-Block enthält WÖRTLICHE Quell-Chunks, jeder mit einem [cNNN]-Label. Verarbeite JEDEN gelieferten Chunk. Aus vielen Chunks entsteht ein langer, detaillierter Artikel – kürze NICHT auf ein bis zwei Sätze zusammen.
- **Nah am Original**: Nutze die Formulierungen der Quelle. Du darfst umordnen, entdoppeln und verwandte Sätze verbinden, aber erfinde keine Übergänge und blähe kurze Aussagen nicht mit Floskeln auf.
- **Nachverfolgbarkeit**: Versieh jede Tatsachenbehauptung, Zahl, Datum oder Beziehung mit dem passenden Inline-Zitat (z.B. [c003]). Bewahre bestehende [cNNN]-Zitate.
- **Struktur**: Beginne mit "# {{pageTitle}}" gefolgt von einem Einleitungsabsatz. Gliedere längere Seiten mit ## Abschnitten (z.B. Hintergrund, Ursachen, Auswirkungen, Ausblick). Nutze Bullet-Listen für Aufzählungen von Fakten.
- **Keine Halluzination**: Erfinde nichts, was nicht in den Quell-Chunks steht.

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

// ---------------------------------------------------------------------------
// Chunk-Citation: Ordnet jedem Kandidaten die Quell-Chunks zu, die ihn
// substanziell behandeln (erzeugt die [cNNN]-Zitatmarker + neue Slugs).
// ---------------------------------------------------------------------------
export const WIKI_CHUNK_CITATION_PROMPT = `Du bist ein präzises Zitationssystem. Scanne die folgenden Dokument-Chunks und entscheide für jeden Kandidaten unten, welche Chunks ihn SUBSTANZIELL behandeln.

<candidate_slugs>
{{candidateSlugs}}
</candidate_slugs>

<chunks>
{{chunksXml}}
</chunks>

<instructions>
**WICHTIG: Schreibe alle Namen und Details auf {{language}}.**

### Hauptaufgabe
Wähle für jeden Kandidaten-Slug oben die Chunk-IDs (aus dem <chunks>-Block), die diese Entität / dieses Konzept **substanziell behandeln**. "Substanziell" heißt: Der Chunk nennt mindestens einen konkreten Fakt, ein Attribut, einen Schritt, ein Datum, eine Zahl, eine Beziehung oder eine andere nützliche Information über den Kandidaten – keine beiläufige Erwähnung.

- Zitiere nur Chunks, die im <chunks>-Block oben vorkommen.
- Verwende das "id"-Attribut jedes <c>-Elements exakt (z.B. "c003").
- Wenn ein Kandidat in KEINEM Chunk dieses Batches sinnvoll behandelt wird, lass ihn in der Ausgabe weg (keine leeren Arrays).
- Ein Chunk KANN von mehreren Kandidaten zitiert werden.

### Zweitaufgabe: neue Slugs
Falls dieses Batch eine wichtige Entität / ein wichtiges Konzept enthüllt, die/das NICHT in <candidate_slugs> steht, füge sie/es unter "new_slugs" hinzu. Nur wirklich neue, substanziell behandelte Elemente. Jeder Eintrag braucht: "type" ("entity" oder "concept"), "name", "slug" (Format "entity/..." bzw. "concept/..."), "aliases", "description", "details", "source_chunks" (Liste der Chunk-IDs aus diesem Batch).

### JSON-Formatierungsregeln
- **KRITISCH**: Verwende KEINE literal line breaks in JSON-String-Werten. Verwende stattdessen \\n.
- Gib NUR gültiges JSON aus, keine Vorrede.
</instructions>

Ausgabeformat:
{
  "citations": {
    "entity/xxx": ["c001", "c003"],
    "concept/yyy": ["c002"]
  },
  "new_slugs": []
}

Falls nichts zitierwürdig ist, gib zurück: {"citations": {}, "new_slugs": []}`;

// ---------------------------------------------------------------------------
// Granularitäts-Guidance – steuert, wie eifrig die Extraktion Kandidaten
// befördert. Wird in {{granularityGuidance}} von WIKI_CANDIDATE_SLUG_PROMPT
// eingesetzt (Quelle: wiki_config.extraction_granularity).
// ---------------------------------------------------------------------------
export const WIKI_GRANULARITY_FOCUSED = `### Extraktions-Umfang (Granularität: fokussiert)
Extrahiere NUR die wichtigsten Entitäten und Konzepte – insgesamt **3-7 Einträge**. Nimm ausschließlich das auf, was zentral für das Dokument ist und mehrfach substanziell diskutiert wird. Lass Nebenfiguren, beiläufig erwähnte Namen und Randthemen weg. Im Zweifel WEGLASSEN.`;

export const WIKI_GRANULARITY_STANDARD = `### Extraktions-Umfang (Granularität: standard)
Extrahiere die bedeutsamen Entitäten und Konzepte – typischerweise **5-15 Einträge**, abhängig von der Dokumentlänge. Nimm auf, was substanziell diskutiert wird (mindestens zweimal erwähnt oder detailliert beschrieben). Lass triviale, nur einmal namentlich genannte Elemente weg.`;

export const WIKI_GRANULARITY_EXHAUSTIVE = `### Extraktions-Umfang (Granularität: erschöpfend)
Extrahiere JEDE benannte Entität und JEDES erkennbare Konzept (Glossar-Modus). Nimm auch einmalig erwähnte, aber klar identifizierbare Elemente auf. Lass nur reine Füllwörter und generische Begriffe ohne eigenständige Bedeutung weg.`;

export function granularityGuidance(granularity?: string): string {
  switch (granularity) {
    case "focused":
      return WIKI_GRANULARITY_FOCUSED;
    case "exhaustive":
      return WIKI_GRANULARITY_EXHAUSTIVE;
    case "standard":
    default:
      return WIKI_GRANULARITY_STANDARD;
  }
}
