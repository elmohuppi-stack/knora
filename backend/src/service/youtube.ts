// YouTube Video Import Service
// Inspiriert von WeKnora's youtube.go: oEmbed-Fallback + Transcript-API

export interface YouTubeInfo {
  videoId: string;
  title: string;
  channelName: string;
  channelUrl: string;
  duration: number;
  thumbnailUrl: string;
  description: string;
  transcript: string;
  transcriptLanguage: string;
}

// YouTube-URL Patterns (wie WeKnora)
const URL_PATTERNS = [
  /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
  /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

export function extractVideoId(url: string): string | null {
  // Zuerst einfache "v" Parameter extrahieren
  try {
    const u = new URL(url);
    if (u.hostname === "youtube.com" || u.hostname.endsWith(".youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
    }
  } catch {}

  // Regex-Patterns
  for (const pattern of URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Metadaten via YouTube oEmbed API (kein API-Key nötig)
async function fetchOEmbed(videoId: string): Promise<{
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailUrl: string;
} | null> {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      title: data.title || "",
      authorName: data.author_name || "",
      authorUrl: data.author_url || "",
      thumbnailUrl: data.thumbnail_url || "",
    };
  } catch {
    return null;
  }
}

// Transkript via youtube-transcript npm package
async function fetchTranscript(videoId: string): Promise<{
  transcript: string;
  language: string;
} | null> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const snippets = await YoutubeTranscript.fetchTranscript(videoId);
    if (!snippets || snippets.length === 0) return null;

    const text = snippets.map((s: any) => s.text).join(" ");
    // Spracherkennung: erstes Snippet hat oft die Sprache
    const language = snippets[0]?.lang || "unknown";

    return { transcript: text, language };
  } catch (e: any) {
    console.warn(`[youtube] Transcript fetch failed:`, e.message);
    return null;
  }
}

// YouTube-VideoInfo mit oEmbed + Transkript
export async function fetchYouTubeInfo(videoId: string): Promise<YouTubeInfo | null> {
  const oembed = await fetchOEmbed(videoId);
  const transcriptResult = await fetchTranscript(videoId);

  if (!oembed && !transcriptResult) {
    console.warn(`[youtube] Could not fetch any data for video ${videoId}`);
    return null;
  }

  return {
    videoId,
    title: oembed?.title || `YouTube Video ${videoId}`,
    channelName: oembed?.authorName || "",
    channelUrl: oembed?.authorUrl || "",
    duration: 0, // oEmbed liefert keine Dauer
    thumbnailUrl: oembed?.thumbnailUrl || "",
    description: `YouTube-Video von ${oembed?.authorName || "unbekannt"}`,
    transcript: transcriptResult?.transcript || "",
    transcriptLanguage: transcriptResult?.language || "unknown",
  };
}

// Text für Chunking aufbereiten (Transkript + Metadaten)
export function buildDocumentContent(info: YouTubeInfo): string {
  const parts: string[] = [];

  parts.push(`# ${info.title}`);
  parts.push(``);
  parts.push(`**Kanal**: ${info.channelName}`);
  parts.push(`**URL**: https://www.youtube.com/watch?v=${info.videoId}`);
  parts.push(``);

  if (info.transcript) {
    parts.push(`## Transkript\n`);
    parts.push(info.transcript);
  }

  return parts.join("\n");
}
