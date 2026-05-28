import { createSignal, createUniqueId, For, onMount, Show } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { invoke } from "@tauri-apps/api/core";

/** Mirrors `src-tauri/src/recent_files.rs::RecentEntry`. */
interface RecentEntry {
  path: string;
  opened_at: string;
}

/** Extract a file/directory name from an absolute path. Pure helper, exported
 * for test discoverability per CLAUDE.md §11 "Business Logic Must Not Live in
 * Inline JSX Handlers". */
export function fileNameFromPath(p: string): string {
  if (!p) return p;
  const segments = p.split(/[/\\]/).filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? p;
}

export function Welcome() {
  const [t] = useTransContext();
  const [recents, setRecents] = createSignal<RecentEntry[]>([]);
  const [reopenList, setReopenList] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal<string>("");
  const reopenHeadingId = createUniqueId();
  const recentsHeadingId = createUniqueId();
  const actionsHeadingId = createUniqueId();

  onMount(async () => {
    try {
      const list = await invoke<RecentEntry[]>("get_recent_workfiles");
      setRecents(list);
    } catch (e) {
      console.error("get_recent_workfiles failed:", e);
    }
    try {
      const restorable = await invoke<string[]>("get_restorable_workfiles");
      setReopenList(restorable);
    } catch (e) {
      console.error("get_restorable_workfiles failed:", e);
    }
  });

  const onReopen = async () => {
    const list = reopenList();
    setStatus(t("welcome:status.reopening", { count: list.length }));
    for (const p of list) {
      try {
        await invoke("open_workfile_path", { path: p });
      } catch (e) {
        console.error(`open_workfile_path ${p} failed:`, e);
      }
    }
    setReopenList([]);
    setStatus(t("welcome:status.reopened"));
  };

  const onSkipReopen = async () => {
    try {
      await invoke("clear_restorable_workfiles");
    } catch (e) {
      console.error("clear_restorable_workfiles failed:", e);
    }
    setReopenList([]);
    setStatus(t("welcome:status.skipped"));
  };

  const onOpen = async () => {
    try {
      await invoke("open_workfile_dialog");
    } catch (e) {
      console.error("open_workfile_dialog failed:", e);
      setStatus(t("welcome:status.openFailed"));
    }
  };

  const onNew = async () => {
    try {
      await invoke("new_workfile_dialog");
    } catch (e) {
      console.error("new_workfile_dialog failed:", e);
      setStatus(t("welcome:status.newFailed"));
    }
  };

  const onRecent = async (path: string) => {
    try {
      await invoke("open_workfile_path", { path });
    } catch (e) {
      console.error(`open recent ${path} failed:`, e);
      setStatus(t("welcome:status.openRecentFailed", { name: fileNameFromPath(path) }));
    }
  };

  return (
    <main role="main" aria-label={t("welcome:ariaLabel")} class="sigil-welcome">
      <header class="sigil-welcome__header">
        <h1>{t("common:appName")}</h1>
      </header>

      <Show when={reopenList().length > 0}>
        {/* The banner is a labelled region, NOT a live region. Per
            a11y-rules.md "`aria-live` Regions Must Be Scoped to Discrete
            Status Changes", a conditionally-mounted element with
            `aria-live` re-announces on every mount; the persistent
            status div below handles announcements. */}
        <section aria-labelledby={reopenHeadingId} class="sigil-welcome-banner">
          <h2 id={reopenHeadingId} class="sigil-welcome-banner__text">
            {t("welcome:reopenPrompt", { count: reopenList().length })}
          </h2>
          <button type="button" onClick={onReopen} class="sigil-welcome-banner__primary">
            {t("welcome:reopen")}
          </button>
          <button type="button" onClick={onSkipReopen} class="sigil-welcome-banner__secondary">
            {t("welcome:skip")}
          </button>
        </section>
      </Show>

      <section aria-labelledby={actionsHeadingId} class="sigil-welcome-actions">
        <h2 id={actionsHeadingId} class="sigil-visually-hidden">
          {t("welcome:actionsHeading")}
        </h2>
        <button type="button" onClick={onOpen}>
          {t("welcome:openWorkfile")}
        </button>
        <button type="button" onClick={onNew}>
          {t("welcome:newWorkfile")}
        </button>
      </section>

      <section aria-labelledby={recentsHeadingId} class="sigil-welcome-recent">
        <h2 id={recentsHeadingId}>{t("welcome:recent")}</h2>
        <Show
          when={recents().length > 0}
          fallback={<p class="sigil-welcome-recent__empty">{t("welcome:recentEmpty")}</p>}
        >
          <ul>
            <For each={recents()}>
              {(entry) => (
                <li>
                  <button type="button" onClick={() => onRecent(entry.path)} title={entry.path}>
                    {fileNameFromPath(entry.path)}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Persistent app-level status region. Per a11y-rules.md, a single
          long-lived `role=status` region carries every announcement; we
          replace its text on each event rather than mounting/unmounting. */}
      <div role="status" aria-live="polite" class="sigil-welcome-status">
        {status()}
      </div>
    </main>
  );
}
