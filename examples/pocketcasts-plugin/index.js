// Pocket Casts source for MyGo Music. Podcasts are shows, episodes are tracks.
// Unofficial API, reverse-engineered from the web player and the Android app.

const t = host.t;

const API = "https://api.pocketcasts.com";
const CACHE = "https://cache.pocketcasts.com";
const SEARCH = "https://search.pocketcasts.com";
const STATIC = "https://static.pocketcasts.com";
const LISTS = "https://lists.pocketcasts.com";
const SHOWNOTES = "https://shownotes.pocketcasts.com";

const WEB_HEADERS = {
  "content-type": "application/json",
  origin: "https://play.pocketcasts.com",
  referer: "https://play.pocketcasts.com/",
};

const PAGE_SIZE = 50;
const EPISODE_PAGE = 50;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---------- settings ----------

function setting(key) {
  return (host.setting(key) || "").trim();
}

function region() {
  return setting("region") || "global";
}

// ---------- auth ----------

let authState;
function loadAuth() {
  if (authState === undefined) authState = host.storage.get("auth") || null;
  return authState;
}
function saveAuth(state) {
  authState = state;
  if (state) host.storage.set("auth", state);
  else host.storage.remove("auth");
}

async function loginWithPassword() {
  const email = setting("email");
  const password = setting("password");
  if (!email || !password) throw fail("setup", t("Enter your Pocket Casts email and password in the plugin settings."));
  const res = await fetch(API + "/user/login_pocket_casts", {
    method: "POST",
    headers: WEB_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401 || res.status === 403) {
    const d = await res.json().catch(() => null);
    throw fail("signIn", (d && d.errorMessage) || t("Email or password is incorrect."));
  }
  if (!res.ok) throw new Error("sign in: HTTP " + res.status);
  const d = await res.json();
  const state = {
    token: d.accessToken,
    refresh: d.refreshToken,
    uuid: d.uuid,
    email: d.email || email,
    expiry: Date.now() + Math.max(60, (d.expiresIn || 3600) - 120) * 1000,
  };
  saveAuth(state);
  memo.clear();
  return state;
}

async function refreshTokens(state) {
  if (!state || !state.refresh) throw fail("signIn", t("Sign in to Pocket Casts"));
  const res = await fetch(API + "/user/token", {
    method: "POST",
    headers: WEB_HEADERS,
    body: JSON.stringify({ grantType: "refresh_token", refreshToken: state.refresh }),
  });
  if (!res.ok) return loginWithPassword();
  const d = await res.json();
  const next = {
    token: d.accessToken,
    refresh: d.refreshToken || state.refresh,
    uuid: d.uuid || state.uuid,
    email: d.email || state.email,
    expiry: Date.now() + Math.max(60, (d.expiresIn || 3600) - 120) * 1000,
  };
  saveAuth(next);
  return next;
}

async function requireAuth() {
  let state = loadAuth();
  if (!state || !state.token) throw fail("signIn", t("Sign in to Pocket Casts"));
  if (Date.now() > (state.expiry || 0)) state = await refreshTokens(state);
  return state;
}

async function api(path, body = {}, method = "POST") {
  const state = await requireAuth();
  const call = () =>
    fetch(API + path, {
      method,
      headers: { ...WEB_HEADERS, authorization: "Bearer " + state.token },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  let res = await call();
  if (res.status === 401) {
    const next = await refreshTokens(state);
    state.token = next.token;
    res = await call();
  }
  if (res.status === 401) throw fail("signIn", t("Sign in to Pocket Casts"));
  if (res.status === 403) throw fail("unavailable", t("This needs a Pocket Casts Plus subscription."));
  if (!res.ok) throw new Error(path + ": HTTP " + res.status);
  return res.json();
}

async function episodeList(path, body = {}) {
  const d = await api(path, body);
  return episodesOf(d).map(normEpisode).map(toEpisodeTrack);
}

async function tryEpisodeList(path, body = {}) {
  try {
    return await episodeList(path, body);
  } catch (e) {
    if (e.code === "unavailable") throw e;
    return [];
  }
}

function episodesOf(data) {
  const e = data && data.episodes;
  if (Array.isArray(e)) return e;
  if (e && typeof e === "object") return Object.entries(e).map(([uuid, v]) => ({ uuid, ...v }));
  return [];
}

// ---------- small helpers ----------

const memo = new Map();
async function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": HTTP " + res.status);
  return res.json();
}

function postJSON(url, body) {
  return fetch(url, { method: "POST", headers: WEB_HEADERS, body: JSON.stringify(body) }).then(async (res) => {
    if (!res.ok) throw new Error(url + ": HTTP " + res.status);
    return res.json();
  });
}

function splitId(id) {
  const i = id.indexOf("|");
  return i < 0 ? [id, ""] : [id.slice(0, i), id.slice(i + 1)];
}

function artworkUrl(uuid) {
  return STATIC + "/discover/images/webp/480/" + uuid + ".webp";
}

function fmtDate(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "";
}

function toShow(p) {
  return {
    id: p.uuid,
    name: p.title || "",
    imageUrl: artworkUrl(p.uuid),
    description: p.description || p.short_description || "",
    publisher: p.author || "",
  };
}

function normEpisode(e) {
  return {
    uuid: e.uuid,
    title: e.title || "",
    url: e.url || "",
    duration: typeof e.duration === "string" ? parseFloat(e.duration) || 0 : e.duration || 0,
    published: e.published || e.published_date || "",
    podcastUuid: e.podcastUuid || e.podcast_uuid || e.podcast || "",
    podcastTitle: e.podcastTitle || e.podcast_title || "",
  };
}

const trackCache = new Map();
function toEpisodeTrack(e) {
  const id = e.uuid + "|" + e.podcastUuid;
  const track = {
    id,
    name: e.title,
    artists: [{ id: e.podcastUuid, name: e.podcastTitle }],
    album: { id: e.podcastUuid, name: e.podcastTitle, imageUrl: e.podcastUuid ? artworkUrl(e.podcastUuid) : "" },
    duration: Math.round((e.duration || 0) * 1000),
    showId: e.podcastUuid,
    published: fmtDate(e.published),
  };
  trackCache.set(id, track);
  return track;
}

async function subscribedSet() {
  if (!loadAuth() || !loadAuth().token) return new Set();
  return cached("subs", 5 * 60 * 1000, async () => {
    const d = await api("/user/podcast/list");
    return new Set((d.podcasts || []).map((p) => p.uuid));
  });
}

async function episodeDetail(uuid) {
  return normEpisode(await api("/user/episode", { uuid }));
}

// ---------- account ----------

export async function signIn() {
  const state = await loginWithPassword();
  return { id: state.uuid, name: state.email, page: "my" };
}

export function signOut() {
  saveAuth(null);
  memo.clear();
}

export async function account() {
  const state = loadAuth();
  if (!state || !state.token) return null;
  return { id: state.uuid, name: state.email, page: "my" };
}

export function setSetting() {
  memo.clear();
}

// ---------- search ----------

export async function search({ query, kind, offset = 0 }) {
  if (offset > 0) return { more: false };
  const q = (query || "").trim();
  if (!q) return { more: false };
  if (kind !== "shows" && kind !== "tracks") return { more: false };
  const d = await cached("search:" + q.toLowerCase(), 60 * 1000, () =>
    postJSON(CACHE + "/v2/search/combined", { term: q }),
  );
  const results = d.results || [];
  if (kind === "shows") {
    return { shows: results.filter((r) => r.type === "podcast").slice(0, 30).map(toShow), more: false };
  }
  return {
    tracks: results.filter((r) => r.type === "episode").slice(0, 30).map((r) => toEpisodeTrack(normEpisode(r))),
    more: false,
  };
}

export async function suggest({ query }) {
  const q = (query || "").trim();
  if (!q) return [];
  const d = await getJSON(
    SEARCH + "/autocomplete/search?q=" + encodeURIComponent(q) + "&termsLimit=10&podcastsLimit=0",
  );
  return (d.results || [])
    .filter((r) => r.type === "term")
    .map((r) => r.value)
    .slice(0, 10);
}

// ---------- library pages ----------

export async function liked({ offset = 0 }) {
  const d = await api("/user/starred");
  const all = episodesOf(d).map(normEpisode);
  return {
    tracks: all.slice(offset, offset + EPISODE_PAGE).map(toEpisodeTrack),
    more: offset + EPISODE_PAGE < all.length,
  };
}

export async function isLiked({ ids }) {
  const state = loadAuth();
  if (!state || !state.token) return Object.fromEntries(ids.map((id) => [id, false]));
  const starred = await cached("starred-ids", 60 * 1000, async () => {
    const d = await api("/user/starred");
    return new Set(episodesOf(d).map((e) => e.uuid));
  });
  return Object.fromEntries(ids.map((id) => [id, starred.has(splitId(id)[0])]));
}

export async function likeEpisode({ id, on }) {
  const [uuid, podcast] = splitId(id);
  const podcastUuid = podcast || (await episodeDetail(uuid)).podcastUuid;
  if (!podcastUuid) throw fail("unavailable", t("This episode can't be played."));
  await api("/sync/update_episode_star", { uuid, podcast: podcastUuid, starred: !!on });
  memo.delete("starred-ids");
}

// Recently played here, kept on this device. MyGo says "played" when a track
// starts, so nothing is written to the server: progress sync stays with the
// official apps.
let recentLog;
function loadRecent() {
  if (!recentLog) recentLog = host.storage.get("recent") || [];
  return recentLog;
}

export function played({ id }) {
  playedHook(id);
  const log = loadRecent().filter((x) => x.id !== id);
  log.unshift({ id, at: Date.now(), track: trackCache.get(id) || null });
  recentLog = log.slice(0, 50);
  host.storage.set("recent", recentLog);
}

export async function recent() {
  const log = loadRecent();
  const tracks = [];
  for (const item of log) {
    if (item.track) {
      tracks.push(item.track);
      continue;
    }
    if (item.tried || !(loadAuth() && loadAuth().token)) continue;
    item.tried = true;
    try {
      const track = toEpisodeTrack(await episodeDetail(splitId(item.id)[0]));
      tracks.push(track);
      item.track = track;
      host.storage.set("recent", log);
    } catch {}
  }
  return tracks;
}

// ---------- sleep timer ----------

// MyGo gives a plugin no way to pause what plays, so the timer stops between
// episodes. It can, because the player asks for the next episode's stream the
// moment the current one starts (it preloads it, ahead.go): that call is where
// the timer decides. If the next episode would begin after the timer runs out,
// it is refused here; the player then skips what's left of the queue and
// stops. A fired timer keeps refusing for a short grace, so the skip pass
// holds, and clears itself after, so the listener can play again.

const SLEEP_GRACE = 90 * 1000;
const PRELOAD_WINDOW = 15 * 1000;

function sleepTimer() {
  return host.storage.get("sleepTimer") || null;
}

function saveSleepTimer(timer) {
  if (timer) host.storage.set("sleepTimer", timer);
  else host.storage.remove("sleepTimer");
}

function sleepStopMessage(timer) {
  return timer.mode === "episodes"
    ? t("Sleep timer: episode limit reached, playback stops.")
    : t("Sleep timer: time is up, playback stops after this episode.");
}

// sleepGate answers why a track must not play, or "" to let it.
function sleepGate() {
  const timer = sleepTimer();
  if (!timer || !timer.mode) return "";
  const now = Date.now();
  if (timer.firedAt) {
    if (now - timer.firedAt >= SLEEP_GRACE) {
      saveSleepTimer(null);
      return "";
    }
    return sleepStopMessage(timer);
  }
  if (timer.mode === "episodes") {
    if ((timer.episodesLeft || 0) <= 0) {
      timer.firedAt = now;
      saveSleepTimer(timer);
      return sleepStopMessage(timer);
    }
    return "";
  }
  // Time mode. The episode playing runs to its end; what the gate decides is
  // whether the next one may start. A stream asked long after the last start
  // is the listener playing something themselves, which the timer doesn't
  // block; and one that comes after the timer already ran out is a listening
  // session of its own, the timer's night being over, so it lets both go.
  const cur = timer.lastPlayed;
  if (!cur || !cur.durMs) return "";
  if (now - cur.at > PRELOAD_WINDOW) return "";
  if (cur.at > timer.expiresAt) {
    saveSleepTimer(null);
    return "";
  }
  if (timer.expiresAt < cur.at + cur.durMs) {
    timer.firedAt = now;
    saveSleepTimer(timer);
    return sleepStopMessage(timer);
  }
  return "";
}

function playedHook(id) {
  const timer = sleepTimer();
  if (!timer || !timer.mode) return;
  const track = trackCache.get(id);
  timer.lastPlayed = { id, at: Date.now(), durMs: (track && track.duration) || 0 };
  if (
    timer.mode === "episodes" &&
    !timer.firedAt &&
    (timer.episodesLeft || 0) > 0 &&
    id !== timer.setDuring &&
    id !== timer.lastCounted
  ) {
    timer.episodesLeft--;
    timer.lastCounted = id;
  }
  saveSleepTimer(timer);
}

function sleepStatus(timer) {
  if (!timer || !timer.mode) return t("Timer is off");
  if (timer.firedAt) return t("Timer fired. Playback stopped.");
  if (timer.mode === "episodes") {
    return t("Episodes left") + ": " + (timer.episodesLeft || 0);
  }
  const left = Math.ceil(((timer.expiresAt || 0) - Date.now()) / 60000);
  return left > 0 ? t("Remaining") + ": " + left + " " + t("min") : t("Timer fired. Playback stopped.");
}

function sleepCustomMinutes() {
  const n = parseInt(setting("sleepCustom"), 10);
  return n >= 1 && n <= 720 ? n : 0;
}

function setSleepTimer(mode, n) {
  const last = loadRecent()[0] || null;
  const timer =
    mode === "time"
      ? {
          mode: "time",
          expiresAt: Date.now() + n * 60000,
          lastPlayed: last ? { id: last.id, at: last.at, durMs: (last.track && last.track.duration) || 0 } : null,
        }
      : { mode: "episodes", episodesLeft: n, setDuring: last ? last.id : "", lastCounted: "" };
  saveSleepTimer(timer);
}

function sleepPage() {
  const timer = sleepTimer();
  const armed = !!(timer && timer.mode && !timer.firedAt);
  const timeLinks = [{ title: t("Off"), subtitle: armed ? "" : t("Timer is off"), page: "sleep:off" }];
  for (const m of [5, 15, 30, 45, 60, 90]) {
    timeLinks.push({ title: m + " " + t("min"), page: "sleep:set:time:" + m });
  }
  const custom = sleepCustomMinutes();
  timeLinks.push(
    custom
      ? { title: t("Custom") + ": " + custom + " " + t("min"), page: "sleep:set:time:" + custom }
      : { title: t("Custom"), subtitle: t("Set your own minutes in the plugin settings"), page: "sleep" },
  );
  const episodeLinks = [1, 2, 3, 5].map((n) => ({
    title: n === 1 ? t("After this episode") : t("After") + " " + n + " " + t("episodes"),
    page: "sleep:set:episodes:" + n,
  }));
  return {
    title: t("Sleep Timer"),
    description: sleepStatus(timer) + "\n" + t("Playback stops between episodes; the one playing runs to its end."),
    sections: [
      { title: t("After a time"), links: timeLinks },
      { title: t("After episodes"), links: episodeLinks },
    ],
  };
}

// ---------- shows (podcasts) ----------

export async function shows() {
  const d = await api("/user/podcast/list");
  return (d.podcasts || []).map((p) => ({ ...toShow(p), subscribed: true }));
}

export async function show({ id, offset = 0 }) {
  const [data, subs, rating] = await Promise.all([
    cached("pod:" + id, 10 * 60 * 1000, () => getJSON(CACHE + "/mobile/podcast/full/" + id)),
    subscribedSet().catch(() => new Set()),
    getJSON(CACHE + "/podcast/rating/" + id).catch(() => null),
  ]);
  const p = data.podcast || {};
  const all = p.episodes || [];
  let description = p.description || "";
  if (rating && rating.average) {
    description = (description ? description + "\n\n" : "") + "★ " + rating.average.toFixed(1) + " (" + (rating.total || 0) + " " + t("ratings") + ")";
  }
  // /mobile/podcast/full puts the podcast uuid only on the podcast itself.
  const pod = { podcastUuid: p.uuid || id, podcastTitle: p.title || "" };
  return {
    show: {
      id: p.uuid || id,
      name: p.title || "",
      imageUrl: artworkUrl(p.uuid || id),
      description,
      publisher: p.author || "",
      episodeCount: data.episode_count || all.length,
      subscribed: subs.has(id),
    },
    episodes: all.slice(offset, offset + EPISODE_PAGE).map((e) => normEpisode({ ...pod, ...e })).map(toEpisodeTrack),
    more: offset + EPISODE_PAGE < all.length,
  };
}

export async function subscribeShow({ id, on }) {
  await api(on ? "/user/podcast/subscribe" : "/user/podcast/unsubscribe", { uuid: id });
  memo.delete("subs");
}

// ---------- discover ----------

const discoverLayout = () =>
  cached("layout", 60 * 60 * 1000, () => getJSON(STATIC + "/discover/web/content_v3.json"));

const categories = () =>
  cached("categories", 24 * 60 * 60 * 1000, () => getJSON(STATIC + "/discover/json/categories_v2.json"));

async function fetchList(rawUrl) {
  const regional = rawUrl.replace("[regionCode]", region());
  try {
    return await cached("list:" + regional, 15 * 60 * 1000, () => getJSON(regional));
  } catch (e) {
    if (regional === rawUrl) throw e;
    return await cached("list:" + rawUrl, 15 * 60 * 1000, () => getJSON(rawUrl));
  }
}

function listShows(list) {
  return (list.podcasts || []).map(toShow);
}

function listPage(url) {
  return "list:" + encodeURIComponent(url);
}

function catSlug(c) {
  const m = (c.source || "").match(/category-(.+)-\[regionCode\]/);
  return m ? m[1] : (c.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const listModules = (layout) =>
  (layout.layout || []).filter((m) => m.type === "podcast_list" && !m.sponsored && m.source);

function popularModule(modules) {
  return modules.find((m) => m.id === "popular_region" && region() !== "global") ||
    modules.find((m) => m.id === "popular") ||
    modules.find((m) => (m.source || "").endsWith("/popular.json"));
}

export async function home() {
  const state = loadAuth();
  const authed = !!(state && state.token);
  const sections = [];

  if (authed) {
    const inProgress = await tryEpisodeList("/user/in_progress");
    if (inProgress.length) {
      sections.push({
        title: t("Continue listening"),
        tracks: inProgress.slice(0, 12),
        pageTitle: t("In Progress"),
        subtitle: t("What you've been listening to"),
      });
    }
    const fresh = await tryEpisodeList("/user/new_releases");
    if (fresh.length) {
      sections.push({
        title: t("New episodes"),
        tracks: fresh.slice(0, 20),
        morePage: "newepisodes",
        pageTitle: t("New Episodes"),
        subtitle: t("Latest from your subscriptions"),
      });
    }
  }

  const layout = await discoverLayout().catch(() => ({}));
  const modules = listModules(layout);
  const wanted = [modules.find((m) => m.id === "featured"), modules.find((m) => m.id === "trending"), popularModule(modules)]
    .filter(Boolean)
    .slice(0, 3);
  for (const m of wanted) {
    const list = await fetchList(m.source).catch(() => null);
    const listShowsArr = list ? listShows(list) : [];
    if (listShowsArr.length) {
      sections.push({
        title: m.title || "",
        shows: listShowsArr.slice(0, 12),
        morePage: listPage(m.source),
        empty: t("Nothing here right now"),
      });
    }
  }

  if (authed) {
    const recd = await tryEpisodeList("/discover/recommend_episodes");
    if (recd.length) {
      sections.push({
        title: t("Recommended for you"),
        tracks: recd.slice(0, 12),
        morePage: "recommend",
        pageTitle: t("Recommended for you"),
        subtitle: t("Episodes picked from what you listen to"),
      });
    }
  }

  const links = [
    { title: t("Discover"), subtitle: t("Everything Pocket Casts suggests"), page: "discover" },
    { title: t("Categories"), subtitle: t("Browse podcasts by category"), page: "categories" },
  ];
  if (authed) {
    links.push(
      { title: t("Up Next"), subtitle: t("Your queue"), page: "upnext" },
      { title: t("Starred"), subtitle: t("Your starred episodes"), page: "starred" },
      { title: t("History"), subtitle: t("What you've been listening to"), page: "history" },
    );
  }
  sections.push({ title: t("Explore"), links });

  return {
    title: "Pocket Casts",
    description: authed ? "" : t("Sign in to see your subscriptions, queue and starred episodes."),
    sections,
  };
}

export async function browse({ page }) {
  const i = page.indexOf(":");
  const kind = i < 0 ? page : page.slice(0, i);
  const arg = i < 0 ? "" : page.slice(i + 1);

  if (kind === "discover") return discoverPage();
  if (kind === "categories") return categoriesPage();
  if (kind === "cat") return categoryPage(arg);
  if (kind === "list") return listPageContent(decodeURIComponent(arg));
  if (kind === "upnext") {
    const tracks = await upNextTracks();
    return { title: t("Up Next"), sections: [{ tracks, empty: t("Your queue is empty") }] };
  }
  if (kind === "newepisodes") {
    const eps = await episodeList("/user/new_releases");
    return { title: t("New Episodes"), sections: [{ tracks: eps.slice(0, 200), empty: t("Nothing here right now") }] };
  }
  if (kind === "inprogress") {
    const eps = await episodeList("/user/in_progress");
    return { title: t("In Progress"), sections: [{ tracks: eps.slice(0, 200), empty: t("Nothing here right now") }] };
  }
  if (kind === "starred") {
    const eps = await episodeList("/user/starred");
    return { title: t("Starred"), sections: [{ tracks: eps.slice(0, 200), empty: t("Nothing here right now") }] };
  }
  if (kind === "history") {
    const eps = await episodeList("/user/history");
    return { title: t("History"), sections: [{ tracks: eps.slice(0, 200), empty: t("Nothing here right now") }] };
  }
  if (kind === "recommend") {
    const eps = await episodeList("/discover/recommend_episodes");
    return {
      title: t("Recommended for you"),
      sections: [{ tracks: eps.slice(0, 200), empty: t("Nothing here right now") }],
    };
  }
  if (kind === "similar") return similarPage(arg);
  if (kind === "my") return myPage();
  if (kind === "sleep") {
    if (arg === "off") {
      saveSleepTimer(null);
      return sleepPage();
    }
    if (arg.startsWith("set:")) {
      const parts = arg.split(":");
      const mode = parts[1] === "episodes" ? "episodes" : "time";
      const n = parseInt(parts[2], 10);
      const max = mode === "episodes" ? 50 : 720;
      if (n >= 1 && n <= max) setSleepTimer(mode, n);
      return sleepPage();
    }
    return sleepPage();
  }
  throw fail("unavailable", "no such page: " + page);
}

async function discoverPage() {
  const layout = await discoverLayout().catch(() => ({}));
  const sections = [];
  const modules = listModules(layout).filter((m) => m.id !== "featured" && m.id !== "trending");
  for (const m of modules.slice(0, 8)) {
    const list = await fetchList(m.source).catch(() => null);
    const listShowsArr = list ? listShows(list) : [];
    if (listShowsArr.length) {
      sections.push({
        title: m.title || "",
        subtitle: m.summary_style === "single_podcast" ? t("Featured podcast") : "",
        shows: listShowsArr.slice(0, 16),
        morePage: listPage(m.source),
        empty: t("Nothing here right now"),
      });
    }
  }
  sections.push({
    title: t("Categories"),
    links: (await categories().catch(() => [])).map((c) => ({
      title: c.name || "",
      imageUrl: c.icon || "",
      page: "cat:" + catSlug(c),
    })),
  });
  return { title: t("Discover"), sections };
}

async function categoriesPage() {
  const cats = await categories().catch(() => []);
  return {
    title: t("Categories"),
    sections: [
      {
        links: cats
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .map((c) => ({ title: c.name || "", imageUrl: c.icon || "", page: "cat:" + catSlug(c) })),
        empty: t("Nothing here right now"),
      },
    ],
  };
}

async function categoryPage(slug) {
  const cats = await categories();
  const cat = cats.find((c) => catSlug(c) === slug);
  if (!cat || !cat.source) throw fail("unavailable", "no such category");
  const list = await fetchList(cat.source);
  return {
    title: cat.name || t("Categories"),
    sections: [{ shows: listShows(list).slice(0, 48), empty: t("Nothing here right now") }],
  };
}

async function listPageContent(url) {
  const d = await fetchList(url);
  const listShowsArr = listShows(d);
  const sections = [];
  if (listShowsArr.length) {
    sections.push({ shows: listShowsArr.slice(0, 48), empty: t("Nothing here right now") });
  }
  if (d.podroll && d.podroll.length) {
    sections.push({ title: t("Podroll"), shows: d.podroll.map(toShow) });
  }
  return {
    title: d.title || t("Discover"),
    subtitle: d.subtitle || "",
    description: d.description || "",
    sections,
  };
}

async function similarPage(uuid) {
  const d = await api("/recommendations/podcast/" + uuid, {}, "GET");
  return {
    title: d.title || t("Similar shows"),
    subtitle: d.subtitle || "",
    sections: [{ shows: (d.podcasts || []).map(toShow), empty: t("Nothing here right now") }],
  };
}

async function myPage() {
  const state = await requireAuth();
  const [inProgress, queue, starred, sub, stats] = await Promise.all([
    tryEpisodeList("/user/in_progress"),
    upNextTracks().catch(() => []),
    tryEpisodeList("/user/starred"),
    fetch(API + "/subscription/status", {
      headers: { ...WEB_HEADERS, authorization: "Bearer " + state.token },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    api("/user/stats/summary").catch(() => null),
  ]);
  const lines = [];
  const tier = sub && (sub.tier || "");
  lines.push(tier ? tier + " · Pocket Casts Plus" : t("Free account"));
  if (stats && stats.timeListened) {
    const total = parseInt(stats.timeListened, 10) || 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    lines.push(t("Listened for") + " " + (h > 0 ? h + " h " : "") + m + " min");
  }
  const sections = [];
  if (inProgress.length) {
    sections.push({ title: t("Continue listening"), tracks: inProgress.slice(0, 12) });
  }
  if (queue.length) {
    sections.push({ title: t("Up Next"), tracks: queue.slice(0, 12), morePage: "upnext" });
  }
  if (starred.length) {
    sections.push({ title: t("Starred"), tracks: starred.slice(0, 12), morePage: "starred" });
  }
  sections.push({
    title: t("Explore"),
    links: [
      { title: t("Discover"), subtitle: t("Everything Pocket Casts suggests"), page: "discover" },
      { title: t("Categories"), subtitle: t("Browse podcasts by category"), page: "categories" },
    ],
  });
  return {
    title: state.email || "Pocket Casts",
    description: lines.join("\n"),
    sections,
  };
}

// ---------- up next ----------

async function upNextTracks() {
  const d = await api("/up_next/list");
  const order = d.order || (d.episodes ? Object.keys(d.episodes) : []);
  const info = d.episodes || {};
  const uuids = order.slice(0, 30);
  const details = await Promise.all(
    uuids.map((u) =>
      api("/user/episode", { uuid: u }).then(
        (e) => normEpisode(e),
        () => normEpisode({ uuid: u, title: (info[u] || {}).title || "", podcastUuid: (info[u] || {}).podcast || "" }),
      ),
    ),
  );
  return details.map(toEpisodeTrack);
}

// ---------- stations ----------

export async function stations() {
  await requireAuth();
  return [
    {
      id: "recommend",
      name: t("Recommended for you"),
      description: t("Episodes picked from what you listen to"),
    },
  ];
}

export async function stationNext({ id }) {
  await requireAuth();
  if (id !== "recommend") throw fail("unavailable", "no such station");
  const d = await api("/discover/recommend_episodes").catch(() => null);
  let eps = episodesOf(d).map(normEpisode);
  if (!eps.length) {
    eps = episodesOf(await api("/user/new_releases")).map(normEpisode);
  }
  return eps.slice(0, 10).map(toEpisodeTrack);
}

// ---------- lyrics (transcripts) ----------

export async function lyrics({ id }) {
  const [uuid, podcast] = splitId(id);
  if (!podcast) throw fail("unavailable", t("No transcript for this episode."));
  const res = await fetch(SHOWNOTES + "/generated_transcripts/" + podcast + "/" + uuid + ".vtt");
  if (!res.ok) throw fail("unavailable", t("No transcript for this episode."));
  const lines = parseVtt(await res.text());
  if (!lines.length) throw fail("unavailable", t("No transcript for this episode."));
  return { lines };
}

function parseVtt(text) {
  const out = [];
  let cue = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(
      /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/,
    );
    if (m) {
      const start = (+(m[1] || 0)) * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4];
      const end = (+(m[5] || 0)) * 3600000 + +m[6] * 60000 + +m[7] * 1000 + +m[8];
      cue = { start, end, text: "" };
      out.push(cue);
      continue;
    }
    if (!cue) continue;
    const line = raw.replace(/<[^>]+>/g, "").trim();
    if (line && !/^(WEBVTT|NOTE|Kind:|Language:)/.test(line) && !/^\d+$/.test(line)) {
      cue.text = cue.text ? cue.text + " " + line : line;
    }
  }
  return out.filter((l) => l.text);
}

// ---------- playback ----------

const EXT_TYPES = [
  [".flac", "flac"],
  [".m4a", "m4a"],
  [".m4b", "m4a"],
  [".aac", "aac"],
  [".ogg", "ogg"],
  [".opus", "ogg"],
  [".oga", "ogg"],
  [".wav", "wav"],
  [".mp3", "mp3"],
];

function typeFromUrl(url) {
  const path = (url || "").split("?")[0].toLowerCase();
  for (const [ext, type] of EXT_TYPES) {
    if (path.endsWith(ext)) return type;
  }
  return "mp3";
}

export async function stream({ id }) {
  const stop = sleepGate();
  if (stop) throw new Error(stop);
  const [uuid, podcast] = splitId(id);
  let url = "";
  if (podcast) {
    try {
      const res = await fetch(CACHE + "/mobile/episode/url/" + podcast + "/" + uuid, {
        headers: { "user-agent": "Pocket Casts" },
      });
      if (res.ok) url = (await res.text()).trim();
    } catch {}
  }
  if (!url) {
    try {
      url = (await episodeDetail(uuid)).url;
    } catch {
      throw fail("unavailable", t("This episode can't be played."));
    }
  }
  if (!url) throw fail("unavailable", t("This episode can't be played."));
  return { url, type: typeFromUrl(url) };
}
