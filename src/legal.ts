// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
//
// Privacy policy and imprint, in English and German. The operator's details come from the
// LEGAL_* variables of the deployment (see wrangler.jsonc), never from this file, so a fork
// shows its own operator. The text describes exactly what src/index.ts, src/ui.html and the
// Workflow do with a visitor's data: update it whenever they change. Keep both languages in step.

import { passIssuer } from "./passes.ts";
import type { Env } from "./types.ts";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);

const COUNTRIES: Record<string, [en: string, de: string]> = { DE: ["Germany", "Deutschland"], AT: ["Austria", "Österreich"], CH: ["Switzerland", "Schweiz"] };
type Lang = "en" | "de";
type Operator = ReturnType<typeof operator> & { passes?: string | null; logs?: LogRegion | null };

function operator(env: Env) {
  const c = COUNTRIES[(env.LEGAL_COUNTRY || "").toUpperCase()] || [env.LEGAL_COUNTRY || "", env.LEGAL_COUNTRY || ""];
  return {
    ok: !!(env.LEGAL_NAME && env.LEGAL_EMAIL),
    name: env.LEGAL_NAME || "",
    business: env.LEGAL_BUSINESS || "",
    street: env.LEGAL_STREET || "",
    city: env.LEGAL_CITY || "",
    country: { en: c[0], de: c[1] },
    email: env.LEGAL_EMAIL || "",
    phone: env.LEGAL_PHONE || "",
    vat: env.LEGAL_VAT_ID || "",
    authority: env.LEGAL_AUTHORITY || "",
  };
}

const address = (o: Operator, lang: Lang) =>
  `<address>${[o.name, o.business, o.street, o.city, o.country[lang]].filter(Boolean).map(esc).join("<br>")}</address>`;
const mail = (o: Operator) => `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`;
const missing = {
  en: "<p class=\"note\">The operator of this copy of convert hasn't filled in their details yet (the LEGAL_* variables).</p>",
  de: "<p class=\"note\">Wer diese Kopie von convert betreibt, hat die eigenen Angaben noch nicht eingetragen (die LEGAL_*-Variablen).</p>",
};

const CF_EN = '<a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Cloudflare\'s privacy policy</a>';
const CF_DE = '<a href="https://www.cloudflare.com/de-de/privacypolicy/" rel="noopener">Datenschutzerklärung von Cloudflare</a>';
const TS = "https://www.cloudflare.com/turnstile-privacy-policy/";

function imprintEn(o: Operator) {
  return `<p>Information pursuant to § 5 DDG:</p>${address(o, "en")}
<p>Email: ${mail(o)}${o.phone ? `<br>Phone: <a href="tel:${esc(o.phone.replace(/[^\d+]/g, ""))}">${esc(o.phone)}</a>` : ""}</p>
${o.vat ? `<p>VAT ID pursuant to § 27a UStG: ${esc(o.vat)}</p>` : ""}
<h2>Consumer dispute resolution</h2>
<p>We are not willing or obliged to take part in dispute resolution proceedings before a consumer arbitration board.</p>
<h2>Independence</h2>
<p>convert is an independent open source project. It uses Cloudflare's services but is not affiliated with or endorsed by Cloudflare. FFmpeg is a trademark of Fabrice Bellard. Names and logos belong to their respective owners.</p>`;
}

function imprintDe(o: Operator) {
  return `<p>Angaben gemäß § 5 DDG:</p>${address(o, "de")}
<p>E-Mail: ${mail(o)}${o.phone ? `<br>Telefon: <a href="tel:${esc(o.phone.replace(/[^\d+]/g, ""))}">${esc(o.phone)}</a>` : ""}</p>
${o.vat ? `<p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${esc(o.vat)}</p>` : ""}
<h2>Verbraucherstreitbeilegung</h2>
<p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
<h2>Unabhängigkeit</h2>
<p>convert ist ein unabhängiges Open-Source-Projekt. Es nutzt Dienste von Cloudflare, steht aber in keiner Verbindung zu Cloudflare und wird von Cloudflare weder unterstützt noch empfohlen. FFmpeg ist eine Marke von Fabrice Bellard. Namen und Logos gehören ihren jeweiligen Inhabern.</p>`;
}

function privacyEn(o: Operator, host: string) {
  return `<p>convert has no accounts and sets no cookies. There is no tracking or advertising, no analysis of visitors or their behavior, and no automated decision-making about you. Nothing is kept in your browser's storage. This policy covers the personal data that is processed nonetheless when you use ${esc(host)}: your IP address, and the files you choose to convert on Cloudflare along with their names.</p>

<h2>Controller</h2>
${address(o, "en")}
<p>Email: ${mail(o)}</p>

<h2>Hosting</h2>
<p>Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, delivers all of convert's pages and files on our behalf, the fonts and the FFmpeg program for your browser included, and runs our Worker, our storage and the conversions described below. To do so, Cloudflare processes your IP address, the address of the page you request, the time, and details your browser sends, such as its user agent and the page you came from. You don't have to provide this data, but without it the site can't be shown to you.</p>
<p>Requests that our Worker handles are also logged, including the IP address, the approximate location Cloudflare derives from it and the address requested. We use these logs only to fix errors and to prevent abuse, and they are deleted after at most 7 days.</p>
<p>To prevent abuse, the Worker counts conversions per connection: per minute in the memory of Cloudflare's rate limiter, and per day in our database. Neither count holds your IP address. Both use a keyed hash of it that changes every day and can't be traced back to the address without our secret key. The daily counts are deleted after 7 days.</p>
<p>The legal basis is our legitimate interest in running convert securely and reliably (Art. 6(1)(f) GDPR). Cloudflare processes the data as our processor under a data processing agreement (Art. 28 GDPR). Cloudflare, Inc. is certified under the EU-U.S. Data Privacy Framework, for which the European Commission has adopted an adequacy decision (Art. 45 GDPR); the agreement also contains the EU standard contractual clauses. More in ${CF_EN}.</p>

${o.logs ? errorLogsEn(o.logs) : ""}<h2>Converting in your browser</h2>
<p>When a file is set to "In your browser", FFmpeg runs on your device and the file never leaves it. Neither we nor Cloudflare see the file, its name or the result. FFmpeg itself is loaded from our server, so no third party learns that you use it.</p>

${o.passes ? `<h2>Passes from stem</h2>
<p>If you have an account at stem (${o.passes}), you can get passes there: each one is one more conversion on Cloudflare once your connection's free ones for the day are used up. When you ask for passes, your browser sends stem blinded requests, together with your stem sign-in. stem signs them without being able to read them, so neither stem nor we can tell later which pass belongs to which account. Your browser keeps the passes in this site's local storage until it spends them or they expire after one to two days; storing them there is strictly necessary for what you asked for (§ 25(2) no. 2 TDDDG). When a pass comes with a conversion, our Worker checks stem's signature and records the pass in our database so it can't be used twice, and deletes that record within three days. We learn nothing about you from a pass. stem's own privacy policy explains what stem stores. The legal basis is our legitimate interest in sharing a free service fairly without tracking anyone (Art. 6(1)(f) GDPR).</p>

` : ""}<h2>Bot check</h2>
<p>Before the first conversion on Cloudflare, and only then, your browser loads Cloudflare Turnstile from challenges.cloudflare.com. Turnstile reads signals from your browser and device, such as the IP address, the user agent and how the browser behaves, to tell people from automated scripts. According to Cloudflare it processes only the data needed for this, and it doesn't read or send what you enter or upload. Our Worker asks Cloudflare whether the check passed. For images it then gives your browser a key that is valid for 20 minutes and is tied to your connection; the key stays in the memory of the open page and isn't stored anywhere. Reading these signals is strictly necessary for the conversion you asked for (§ 25(2) no. 2 TDDDG). The legal basis is our legitimate interest in keeping automated abuse away from a free service (Art. 6(1)(f) GDPR). More in Cloudflare's <a href="${TS}" rel="noopener">Turnstile privacy addendum</a>.</p>

<h2>Converting on Cloudflare</h2>
<p>Images are sent to our Worker and converted by Cloudflare Images in a single request. The image and the result exist only in memory while that request runs and are not stored. Cloudflare removes metadata such as location and camera details from the result; a JPEG keeps at most a copyright note that was already in the original.</p>
<p>Videos are uploaded either to our storage at Cloudflare (Cloudflare R2, for MP4 files up to 100 MB) or straight from your browser to Cloudflare Stream (upload.videodelivery.net, for every other video). The original is deleted as soon as the conversion is done, a copy in Stream as soon as the result is saved, and an upload whose conversion never starts after 3 hours at the latest. The result stays in our storage for at most 24 hours and can be downloaded by anyone who has its link, which contains a long random ID. While a video is being converted we keep a job record with the file name, the chosen settings, the progress and the daily hashed connection described under "Hosting". Job records are deleted after 2 days.</p>
<p>We don't look at the files you convert and don't use them for anything else. The legal basis is the conversion you ask for (Art. 6(1)(b) GDPR). Cloudflare processes the files as our processor, as described under "Hosting". Please don't upload files whose content you aren't allowed to share with a service provider.</p>

<h2>Email</h2>
<p>If you email us, we use your address and message only to reply (Art. 6(1)(f) GDPR) and delete them once the matter is settled, unless the law requires us to keep them.</p>

<h2>Your rights</h2>
<p>You have the right of access to your personal data (Art. 15 GDPR), to rectification (Art. 16), to erasure (Art. 17), to restriction of processing (Art. 18) and to data portability (Art. 20). To exercise them, email us. You can also lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), for example the one where you live${o.authority ? ` or the one responsible for us: ${esc(o.authority)}` : ""}.</p>

<h2>Right to object</h2>
<p><strong>You may object at any time, on grounds relating to your particular situation, to the processing of your personal data based on Art. 6(1)(f) GDPR (Art. 21 GDPR).</strong></p>`;
}

function privacyDe(o: Operator, host: string) {
  return `<p>convert hat keine Benutzerkonten und setzt keine Cookies. Es verwendet keine Tracking- oder Werbedienste, wertet weder Besucher noch ihr Verhalten aus und trifft keine automatisierten Entscheidungen über dich. Im Speicher deines Browsers legt convert nichts ab. Diese Erklärung beschreibt, welche personenbezogenen Daten trotzdem verarbeitet werden, wenn du ${esc(host)} nutzt: deine IP-Adresse und die Dateien, die du bei Cloudflare umwandeln lässt, samt ihren Namen.</p>

<h2>Verantwortlicher</h2>
${address(o, "de")}
<p>E-Mail: ${mail(o)}</p>

<h2>Hosting</h2>
<p>Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, liefert in unserem Auftrag alle Seiten und Dateien von convert aus, auch die Schriften und das FFmpeg-Programm für deinen Browser, und betreibt unseren Worker, unseren Speicher und die unten beschriebenen Umwandlungen. Dazu verarbeitet Cloudflare deine IP-Adresse, die Adresse der aufgerufenen Seite, den Zeitpunkt und Angaben, die dein Browser mitsendet, etwa den User-Agent und die Seite, von der du kommst. Du musst diese Daten nicht bereitstellen, ohne sie kann die Website aber nicht angezeigt werden.</p>
<p>Anfragen, die unser Worker bearbeitet, werden zusätzlich protokolliert, samt IP-Adresse, dem ungefähren Standort, den Cloudflare daraus ableitet, und der aufgerufenen Adresse. Wir nutzen diese Protokolle nur, um Fehler zu beheben und Missbrauch zu verhindern; sie werden nach spätestens 7 Tagen gelöscht.</p>
<p>Um Missbrauch zu verhindern, zählt der Worker Umwandlungen pro Verbindung: pro Minute im Arbeitsspeicher von Cloudflares Rate-Limiter und pro Tag in unserer Datenbank. Keine der beiden Zählungen enthält deine IP-Adresse. Beide nutzen einen mit einem geheimen Schlüssel gebildeten Hash davon, der sich täglich ändert und sich ohne unseren geheimen Schlüssel nicht auf die Adresse zurückführen lässt. Die Tageszählungen werden nach 7 Tagen gelöscht.</p>
<p>Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb von convert (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare verarbeitet die Daten als unser Auftragsverarbeiter auf Grundlage eines Auftragsverarbeitungsvertrags (Art. 28 DSGVO). Cloudflare, Inc. ist nach dem EU-U.S. Data Privacy Framework zertifiziert, für das ein Angemessenheitsbeschluss der Europäischen Kommission besteht (Art. 45 DSGVO); der Vertrag enthält zusätzlich die EU-Standardvertragsklauseln. Mehr dazu in der ${CF_DE}.</p>

${o.logs ? errorLogsDe(o.logs) : ""}<h2>Umwandeln im Browser</h2>
<p>Steht eine Datei auf „In your browser“, läuft FFmpeg auf deinem Gerät und die Datei verlässt es nicht. Weder wir noch Cloudflare sehen die Datei, ihren Namen oder das Ergebnis. FFmpeg selbst wird von unserem Server geladen, kein Dritter erfährt also, dass du es nutzt.</p>

${o.passes ? `<h2>Pässe von stem</h2>
<p>Wenn du ein Konto bei stem (${o.passes}) hast, kannst du dort Pässe holen: Jeder Pass ist eine weitere Umwandlung bei Cloudflare, sobald die kostenlosen deiner Verbindung für heute verbraucht sind. Wenn du Pässe anforderst, schickt dein Browser stem verblendete Anfragen, zusammen mit deiner Anmeldung bei stem. stem signiert sie, ohne sie lesen zu können, sodass weder stem noch wir später erkennen, welcher Pass zu welchem Konto gehört. Dein Browser bewahrt die Pässe im lokalen Speicher dieser Seite auf, bis er sie einlöst oder sie nach ein bis zwei Tagen ablaufen; das Speichern dort ist für das, worum du gebeten hast, unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Kommt ein Pass mit einer Umwandlung, prüft unser Worker die Signatur von stem und vermerkt den Pass in unserer Datenbank, damit er nicht zweimal eingelöst wird, und löscht diesen Vermerk innerhalb von drei Tagen. Aus einem Pass erfahren wir nichts über dich. Was stem speichert, steht in der Datenschutzerklärung von stem. Rechtsgrundlage ist unser berechtigtes Interesse, einen kostenlosen Dienst fair zu verteilen, ohne jemanden zu verfolgen (Art. 6 Abs. 1 lit. f DSGVO).</p>

` : ""}<h2>Bot-Prüfung</h2>
<p>Vor der ersten Umwandlung bei Cloudflare, und nur dann, lädt dein Browser Cloudflare Turnstile von challenges.cloudflare.com. Turnstile liest Signale deines Browsers und Geräts, etwa die IP-Adresse, den User-Agent und wie sich der Browser verhält, um Menschen von automatisierten Skripten zu unterscheiden. Nach Angaben von Cloudflare verarbeitet es dafür nur die nötigen Daten und liest oder sendet nichts von dem, was du eingibst oder hochlädst. Unser Worker fragt bei Cloudflare nach, ob die Prüfung bestanden ist. Für Bilder gibt er deinem Browser danach einen Schlüssel, der 20 Minuten gilt und an deine Verbindung gebunden ist; er liegt nur im Arbeitsspeicher der geöffneten Seite und wird nirgends gespeichert. Das Auslesen dieser Signale ist für die von dir gewünschte Umwandlung unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Rechtsgrundlage ist unser berechtigtes Interesse, automatisierten Missbrauch von einem kostenlosen Dienst fernzuhalten (Art. 6 Abs. 1 lit. f DSGVO). Mehr dazu im <a href="${TS}" rel="noopener">Turnstile Privacy Addendum</a> von Cloudflare.</p>

<h2>Umwandeln bei Cloudflare</h2>
<p>Bilder werden an unseren Worker geschickt und von Cloudflare Images in einer einzigen Anfrage umgewandelt. Bild und Ergebnis existieren nur im Arbeitsspeicher, solange diese Anfrage läuft, und werden nicht gespeichert. Cloudflare entfernt Metadaten wie Standort- und Kameraangaben aus dem Ergebnis; ein JPEG behält höchstens einen Urheberrechtsvermerk, der schon im Original stand.</p>
<p>Videos werden entweder in unseren Speicher bei Cloudflare hochgeladen (Cloudflare R2, für MP4-Dateien bis 100 MB) oder direkt aus deinem Browser zu Cloudflare Stream (upload.videodelivery.net, für alle anderen Videos). Das Original wird gelöscht, sobald die Umwandlung fertig ist, eine Kopie in Stream, sobald das Ergebnis gespeichert ist, und ein Upload, dessen Umwandlung nie beginnt, spätestens nach 3 Stunden. Das Ergebnis bleibt höchstens 24 Stunden in unserem Speicher und kann von allen heruntergeladen werden, die seinen Link haben; der Link enthält eine lange Zufalls-ID. Während ein Video umgewandelt wird, führen wir einen Auftragseintrag mit Dateiname, gewählten Einstellungen, Fortschritt und dem unter „Hosting“ beschriebenen täglichen Hash der Verbindung. Auftragseinträge werden nach 2 Tagen gelöscht.</p>
<p>Wir sehen uns die Dateien, die du umwandelst, nicht an und nutzen sie für nichts anderes. Rechtsgrundlage ist die Umwandlung, die du anforderst (Art. 6 Abs. 1 lit. b DSGVO). Cloudflare verarbeitet die Dateien als unser Auftragsverarbeiter, wie unter „Hosting“ beschrieben. Bitte lade keine Dateien hoch, deren Inhalt du nicht an einen Dienstleister weitergeben darfst.</p>

<h2>E-Mail</h2>
<p>Wenn du uns schreibst, nutzen wir deine Adresse und Nachricht nur, um dir zu antworten (Art. 6 Abs. 1 lit. f DSGVO), und löschen sie, sobald die Sache erledigt ist, es sei denn, das Gesetz verpflichtet uns zur Aufbewahrung.</p>

<h2>Deine Rechte</h2>
<p>Du hast das Recht auf Auskunft über deine personenbezogenen Daten (Art. 15 DSGVO), auf Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20). Schreib uns dazu eine E-Mail. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), etwa bei der an deinem Wohnort${o.authority ? ` oder bei der für uns zuständigen: ${esc(o.authority)}` : ""}.</p>

<h2>Widerspruchsrecht</h2>
<p><strong>Du kannst der Verarbeitung deiner personenbezogenen Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO jederzeit aus Gründen widersprechen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO).</strong></p>`;
}

const UPDATED: Record<Lang, string> = { en: "Last updated 26 November 2026", de: "Stand: 26. November 2026" };

// Set POSTHOG_LOGS to "eu" or "us" when the Worker's logs are exported to PostHog (see README).
type LogRegion = Record<Lang, string>;
const LOG_REGION: Record<string, LogRegion> = { eu: { en: "the EU (Frankfurt)", de: "in der EU (Frankfurt)" }, us: { en: "the USA", de: "in den USA" } };
const logRegion = (v: unknown): LogRegion | null => LOG_REGION[String(v ?? "").trim().toLowerCase()] ?? null;
const errorLogsEn = (where: LogRegion): string => `<h2>Logs at PostHog</h2>
<p>A short log line for each request (IP address, approximate location, the page requested without job IDs, the chosen target format, the response status, your browser type and language), a line for each finished conversion (engine, target format and duration) and the error messages our Worker writes (such as which step failed and the technical ID of the conversion concerned) are sent to PostHog Inc., 2261 Market St. #4008, San Francisco, CA 94114, USA, which stores them for us on servers in ${where.en}. They contain no file contents or file names. We use them only to fix errors and to prevent abuse, and PostHog deletes them after 14 days. The legal basis is our legitimate interest in running convert securely and reliably (Art. 6(1)(f) GDPR). PostHog processes the data as our processor under a data processing agreement (Art. 28 GDPR) that contains the EU standard contractual clauses. More in <a href="https://posthog.com/privacy" rel="noopener">PostHog's privacy policy</a>.</p>
`;
const errorLogsDe = (where: LogRegion): string => `<h2>Protokolle bei PostHog</h2>
<p>Eine kurze Protokollzeile je Anfrage (IP-Adresse, ungefährer Standort, die aufgerufene Seite ohne Job-IDs, das gewählte Zielformat, der Antwortstatus, Browsertyp und Sprache), eine Zeile je fertiger Umwandlung (Verfahren, Zielformat und Dauer) und die Fehlermeldungen, die unser Worker schreibt (etwa welcher Schritt fehlgeschlagen ist und die technische ID der betroffenen Umwandlung), werden an PostHog Inc., 2261 Market St. #4008, San Francisco, CA 94114, USA, gesendet, die sie für uns auf Servern ${where.de} speichert. Sie enthalten keine Dateiinhalte und keine Dateinamen. Wir nutzen sie nur, um Fehler zu beheben und Missbrauch zu verhindern, und PostHog löscht sie nach 14 Tagen. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb von convert (Art. 6 Abs. 1 lit. f DSGVO). PostHog verarbeitet die Daten als unser Auftragsverarbeiter auf Grundlage eines Auftragsverarbeitungsvertrags (Art. 28 DSGVO), der die EU-Standardvertragsklauseln enthält. Mehr dazu in der <a href="https://posthog.com/privacy" rel="noopener">Datenschutzerklärung von PostHog</a>.</p>
`;


type LegalPage = { lang: Lang; title: string; other: string; otherLabel: string; body: (o: Operator, host: string) => string; updated?: boolean };

export const LEGAL: Record<string, LegalPage> = {
  privacy: { lang: "en", title: "Privacy policy", other: "datenschutz", otherLabel: "Deutsch", body: privacyEn, updated: true },
  datenschutz: { lang: "de", title: "Datenschutzerklärung", other: "privacy", otherLabel: "English", body: privacyDe, updated: true },
  imprint: { lang: "en", title: "Imprint", other: "impressum", otherLabel: "Deutsch", body: imprintEn },
  impressum: { lang: "de", title: "Impressum", other: "imprint", otherLabel: "English", body: imprintDe },
};

export function legalPage(slug: string, env: Env, origin: string) {
  const p = LEGAL[slug];
  const o: Operator = operator(env);
  o.passes = passIssuer(env) ? new URL(passIssuer(env)!).host : null;
  o.logs = logRegion(env.POSTHOG_LOGS);
  const host = new URL(origin).host;
  const back = p.lang === "de" ? "Zurück zu convert" : "Back to convert";
  return `<!doctype html>
<html lang="${p.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · convert.</title><meta name="robots" content="noindex">
<link rel="canonical" href="${esc(origin + "/" + slug)}"><link rel="alternate" hreflang="${p.lang === "de" ? "en" : "de"}" href="${esc(origin + "/" + p.other)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts.css">
<style>body{margin:0;font:16px/1.65 "General Sans",system-ui,sans-serif;color:#1A1216;background:#F6F1EE;padding:clamp(28px,6vw,72px) clamp(20px,5vw,56px)}
main{max-width:720px;margin:0 auto}h1{font:600 clamp(32px,6vw,52px)/1.05 "Clash Display",system-ui,sans-serif;letter-spacing:-.03em;margin:18px 0 10px}h1 span{color:#FF2E52}
h2{font:600 22px/1.2 "Clash Display",system-ui,sans-serif;letter-spacing:-.01em;margin:40px 0 10px}address{font-style:normal;margin:0 0 1em}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px}.top img{width:40px;height:40px;display:block}
.meta{font:400 13px/1.4 "JetBrains Mono",ui-monospace,monospace;color:#6E6468;margin:0 0 28px}
a{color:#C81040}.pill{font:500 13px/1 "JetBrains Mono",ui-monospace,monospace;color:#1A1216;padding:10px 14px;border-radius:999px;box-shadow:inset 0 0 0 1px #E2D8D5;text-decoration:none}
.pill:hover{box-shadow:inset 0 0 0 1px #C81040;color:#C81040}.note{padding:14px 18px;border-radius:12px;background:#FFF1F3}
footer{max-width:720px;margin:56px auto 0;padding-top:20px;border-top:1px solid #E2D8D5;display:flex;flex-wrap:wrap;gap:10px 22px;font-size:14px}footer a{color:#6E6468}</style></head>
<body><main><div class="top"><a href="/" aria-label="${back}"><img src="/favicon.svg" alt=""></a><a class="pill" href="/${p.other}" hreflang="${p.lang === "de" ? "en" : "de"}" lang="${p.lang === "de" ? "en" : "de"}">${p.otherLabel}</a></div>
<h1>${esc(p.title)}<span>.</span></h1>${p.updated ? `<p class="meta">${UPDATED[p.lang]}</p>` : ""}
${o.ok ? "" : missing[p.lang]}${p.body(o, host)}</main>
<footer><a href="/">${back}</a><a href="/privacy">Privacy</a><a href="/datenschutz">Datenschutz</a><a href="/imprint">Imprint</a><a href="/impressum">Impressum</a></footer></body></html>`;
}
