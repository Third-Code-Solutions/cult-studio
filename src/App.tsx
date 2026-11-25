import { useCallback, useEffect, useRef, useState } from 'react';
import { AddSource } from './components/AddSource';
import { BottomBar } from './components/BottomBar';
import { EndConfirm, GoalDialog, HelpDialog, LiveSetup, ObsPanel, RankingDialog, SettingsDialog, SummaryDialog } from './components/Dialogs';
import { LeftPanel, type Layout, type Tool, type View } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { NotCreator, SignIn } from './components/SignIn';
import { FiltersDialog, ShapeDialog, SourceMenu, type SourceAction } from './components/SourceMenu';
import { Stage } from './components/Stage';
import { TitleBar } from './components/TitleBar';
import { api, bridge, call, type Category, type CreatorStatus, type Display, type Me, type Settings } from './lib/bridge';
import * as comp from './lib/compositor';
import { errorText } from './lib/errors';
import * as sc from './lib/scene';
import { useLive, type Setup } from './lib/useLive';

const DEFAULT_SETUP: Setup = { title: '', category: 'slots-casino', tags: [], orientation: 'portrait', replay: true, rights: false, betting: null };

type DialogName = 'setup' | 'add' | 'goal' | 'ranking' | 'obs' | 'settings' | 'help' | 'end' | 'source' | 'shape' | 'filters';

function Studio({ me, settings, onSignOut }: { me: Me; settings: Settings; onSignOut: () => void }) {
  const [scenes, setScenes] = useState<sc.Scene[]>(() => [sc.newScene('Scene 1')]);
  const [programId, setProgramId] = useState(() => scenes[0]!.id);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [view, setView] = useState<View>('studio');
  const [layout, setLayoutState] = useState<Layout>('portrait');
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [addCanvas, setAddCanvas] = useState<sc.Orientation>('portrait');
  const [goalTarget, setGoalTarget] = useState(10);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rtState, setRtState] = useState('closed');
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [cropId, setCropId] = useState<string | null>(null);
  const [clip, setClip] = useState<{ source: sc.Source; sceneId: string } | null>(null); // in-app clipboard
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const live = useLive(me.id);

  const director = previewId !== null;
  const editingId = previewId ?? programId;
  const editing = scenes.find((s) => s.id === editingId);
  const main = setup.orientation;
  const isLive = live.phase === 'live' || live.phase === 'ending';
  const canvases: sc.Orientation[] = view === 'mobile' ? ['portrait'] : director ? [main] : layout === 'both' ? ['portrait', 'landscape'] : [layout];
  const selected = editing?.sources.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    comp.start();
    api<{ categories: Category[] }>('GET', '/v1/config').then((c) => setCategories(c.categories.filter((x) => x.enabled)), () => undefined);
    return bridge().onRealtimeState((s) => setRtState(String(s)));
  }, []);
  useEffect(() => comp.setDrawState({ scenes, programId, previewId }), [scenes, programId, previewId]);
  // Sign-out unmounts the studio: turn off cameras/captures and stop drawing this session's scenes.
  const scenesRef = useRef(scenes);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  useEffect(
    () => () => {
      scenesRef.current.forEach((s) => s.sources.forEach((x) => comp.releaseMedia(x.sid)));
      if (clipRef.current) comp.releaseMedia(clipRef.current.source.sid);
      comp.setDrawState({ scenes: [], programId: '', previewId: null });
    },
    [],
  );
  useEffect(() => {
    comp.widgets.goalTarget = goalTarget;
  }, [goalTarget]);

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    if (l !== 'both' && !isLive) setSetup((s) => ({ ...s, orientation: l }));
  };
  const setDirector = (on: boolean) => {
    setPreviewId(on ? (scenes.find((s) => s.id !== programId)?.id ?? programId) : null);
    setSelectedId(null);
  };
  const patchSource = useCallback((id: string, patch: Partial<sc.Source>) => setScenes((all) => sc.updateSource(all, editingId, id, patch)), [editingId]);
  /** Stop media nobody uses any more (no item with that sid left, and not on the clipboard). */
  const releaseUnused = (next: sc.Scene[], gone: sc.Source[]) => {
    for (const g of gone) if (clipRef.current?.source.sid !== g.sid && !next.some((x) => x.sources.some((y) => y.sid === g.sid))) comp.releaseMedia(g.sid);
  };
  const removeSource = (id: string) => {
    const gone = editing?.sources.find((s) => s.id === id);
    if (!gone) return;
    const next = sc.removeSource(scenes, editingId, id);
    setScenes(next);
    releaseUnused(next, [gone]);
    if (selectedId === id) setSelectedId(null);
    if (cropId === id) setCropId(null);
  };
  const addSourceTo = (src: sc.Source) => {
    setScenes((all) => sc.addSource(all, editingId, src));
    setSelectedId(src.id);
  };
  const addWidget = (kind: sc.SourceKind, name: string) => {
    const box = sc.widgetBox(kind, main);
    addSourceTo({ id: sc.uid('src'), sid: sc.uid('sid'), kind, name, canvas: main, visible: true, locked: false, ...box, home: box });
  };
  const hasWidget = (kind: sc.SourceKind) => !!editing?.sources.some((s) => s.kind === kind);

  const selectScene = (id: string) => {
    if (director) setPreviewId(id);
    else setProgramId(id);
    setSelectedId(null);
  };
  const deleteScene = (id: string) => {
    const gone = scenes.find((s) => s.id === id);
    if (!gone || scenes.length < 2 || id === programId) return;
    const rest = scenes.filter((s) => s.id !== id);
    setScenes(rest);
    releaseUnused(rest, gone.sources);
    if (previewId === id) setPreviewId(rest[0]!.id);
  };
  const addScene = () => {
    const s = sc.newScene(`Scene ${scenes.length + 1}`);
    setScenes([...scenes, s]);
    selectScene(s.id);
  };

  // ── Source menu: copy/paste, transforms, projector ──
  const copy = (s: sc.Source) => {
    const old = clipRef.current?.source;
    clipRef.current = { source: s, sceneId: editingId };
    setClip(clipRef.current);
    if (old && old.sid !== s.sid) releaseUnused(scenes, [old]);
  };
  const paste = (mode: 'reference' | 'duplicate') => {
    const c = clipRef.current;
    if (!c || !editing) return;
    const now = scenes.flatMap((x) => x.sources).find((x) => x.sid === c.source.sid); // settings as they are now
    const base = now ? { ...c.source, ...sc.sharedOf(now) } : c.source;
    const src = sc.pastedSource(base, mode, canvases.includes(base.canvas) ? base.canvas : main, c.sceneId === editingId ? 40 : 0);
    if (mode === 'duplicate') comp.aliasMedia(src.sid, c.source.sid); // same capture/camera stream, no second capture
    addSourceTo(src);
  };
  const openMenu = (x: number, y: number, id: string | null) => {
    setMenu({ x, y, id });
    if (id) void call<Display[]>(bridge().displays()).then(setDisplays, () => setDisplays([]));
  };
  const act = (a: SourceAction, id: string | null) => {
    if (a === 'paste-ref' || a === 'paste-dup') return paste(a === 'paste-ref' ? 'reference' : 'duplicate');
    const s = editing?.sources.find((x) => x.id === id);
    if (!s) return;
    const patch = (p: Partial<sc.Source>) => patchSource(s.id, p);
    if (typeof a === 'object') {
      try {
        comp.openProjector(s.id, s.name, a.project);
      } catch (e) {
        setNotice(errorText(e));
      }
      return;
    }
    switch (a) {
      case 'settings':
        return setDialog('source');
      case 'shape':
      case 'filters':
        return setDialog(a);
      case 'reset':
        return patch(sc.resetPatch(s));
      case 'delete':
        return removeSource(s.id);
      case 'rename':
        return setRenameId(s.id);
      case 'copy':
        return copy(s);
      case 'fit':
      case 'stretch':
      case 'fill':
        return patch(sc.fullScreenBox(s, a, comp.mediaSize(s.sid)));
      case 'center-h':
        return patch(sc.centerBox(s, 'h'));
      case 'center-v':
        return patch(sc.centerBox(s, 'v'));
      case 'center-both':
        return patch(sc.centerBox(s, 'both'));
      case 'crop':
        return setCropId(s.id);
      case 'rot-cw':
        return patch(sc.rotatePatch(s, 90));
      case 'rot-ccw':
        return patch(sc.rotatePatch(s, -90));
      case 'rot-180':
        return patch(sc.rotatePatch(s, 180));
      case 'flip-h':
        return patch({ flipH: !s.flipH });
      case 'flip-v':
        return patch({ flipV: !s.flipV });
      case 'front':
      case 'back':
        return setScenes((all) => sc.layerSource(all, editingId, s.id, a));
      case 'forward':
      case 'backward':
        return setScenes((all) => sc.moveSource(all, editingId, s.id, a === 'forward' ? 1 : -1));
    }
  };
  // Ctrl+C / Ctrl+V on the stage or the Sources list (not while typing); Esc leaves crop mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .ctx')) return;
      if (e.key === 'Escape') return setCropId(null);
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !t.closest('.stage, .sources')) return;
      const k = e.key.toLowerCase();
      if (k === 'c' && selected) {
        e.preventDefault();
        copy(selected);
      } else if (k === 'v' && clipRef.current) {
        e.preventDefault();
        paste('reference');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!cropId) return;
    const off = (e: PointerEvent) => !(e.target as Element).closest?.('[data-crop], .ctx') && setCropId(null); // click elsewhere ends crop mode
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  }, [cropId]);

  const goLive = () => {
    if (setup.title.trim().length < 3 || !setup.rights) return setDialog('setup');
    void live.goLive(setup, comp.program[main]);
  };
  const onTool = (t: Tool) => setDialog(t);
  const catName = categories.find((c) => c.slug === setup.category)?.name ?? 'Slots & Casino';
  const liveError = live.error;

  return (
    <div className="app">
      <TitleBar
        me={me}
        apiBase={settings.apiBase}
        title={live.stream?.title ?? setup.title}
        category={catName}
        isLive={isLive}
        onOpenSetup={() => setDialog('setup')}
        onSettings={() => setDialog('settings')}
        onHelp={() => setDialog('help')}
        onSignOut={() => (isLive ? setNotice('End LIVE before signing out.') : onSignOut())}
      />
      <div className="main">
        <LeftPanel
          view={view}
          setView={setView}
          director={director}
          setDirector={setDirector}
          layout={layout}
          setLayout={setLayout}
          isLive={isLive}
          mainOrientation={main}
          scenes={scenes}
          editingId={editingId}
          programId={programId}
          previewId={previewId}
          onSelectScene={selectScene}
          onAddScene={addScene}
          onRenameScene={(id, name) => setScenes((all) => all.map((s) => (s.id === id ? { ...s, name } : s)))}
          onDeleteScene={deleteScene}
          canvases={canvases}
          selectedId={selectedId}
          onSelectSource={setSelectedId}
          onPatchSource={patchSource}
          onRemoveSource={removeSource}
          onMoveSource={(id, d) => setScenes((all) => sc.moveSource(all, editingId, id, d))}
          onAddSource={(o) => (setAddCanvas(o), setDialog('add'))}
          onTool={onTool}
          renameId={renameId}
          onRenameSource={setRenameId}
          onContext={openMenu}
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {(liveError || notice) && (
            <div className="notice error" role="alert" style={{ borderRadius: 0, alignItems: 'center' }}>
              <strong>{liveError?.message ?? notice}</strong>
              <span style={{ flex: 1 }} />
              {liveError?.resumeId && (
                <button className="btn sm" onClick={() => void live.goLive(setup, comp.program[main], liveError.resumeId)}>
                  Resume that stream here
                </button>
              )}
              <button className="icon-btn" aria-label="Dismiss" onClick={() => (live.setError(null), setNotice(null))}>
                ×
              </button>
            </div>
          )}
          <Stage
            view={view}
            layout={layout}
            director={director}
            mainOrientation={main}
            editing={editing}
            programScene={scenes.find((s) => s.id === programId)}
            selected={selected}
            isLive={isLive}
            onSelect={setSelectedId}
            onPatch={patchSource}
            onSwitch={() => previewId && setProgramId(previewId)}
            onAddSource={(o) => (setAddCanvas(o), setDialog('add'))}
            cropId={cropId}
            onContext={openMenu}
          />
        </div>
        <RightPanel isLive={isLive} viewers={live.viewers} stats={live.stats} chat={live.chat} chatError={live.chatError} rtState={rtState} apiBase={settings.apiBase} onSend={live.sendChat} />
      </div>
      <BottomBar phase={live.phase} liveAt={live.liveAt} health={live.health} canGoLive onGoLive={goLive} onEnd={() => setDialog('end')} onAudioError={setNotice} />

      {dialog === 'setup' && <LiveSetup setup={setup} categories={categories} isLive={isLive} streamId={live.stream?.id ?? null} onSave={(s) => (setSetup(s), setLayoutState((l) => (l === 'both' || isLive ? l : s.orientation)))} onClose={() => setDialog(null)} />}
      {dialog === 'add' && <AddSource canvases={canvases} initialCanvas={canvases.includes(addCanvas) ? addCanvas : canvases[0]!} goalTarget={goalTarget} onGoalTarget={setGoalTarget} onAdd={addSourceTo} onClose={() => setDialog(null)} />}
      {dialog === 'goal' && <GoalDialog target={goalTarget} current={live.stats?.gifts.count ?? 0} hasWidget={hasWidget('goal')} onSave={setGoalTarget} onAddWidget={() => addWidget('goal', 'Goal bar')} onClose={() => setDialog(null)} />}
      {dialog === 'ranking' && <RankingDialog stats={live.stats} isLive={isLive} hasWidget={hasWidget('ranking')} onAddWidget={() => addWidget('ranking', 'Viewer ranking')} onClose={() => setDialog(null)} />}
      {dialog === 'obs' && <ObsPanel onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog settings={settings} isLive={isLive} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'end' && <EndConfirm onEnd={() => void live.end()} onClose={() => setDialog(null)} />}
      {dialog === 'source' && selected && (
        <AddSource
          canvases={canvases}
          initialCanvas={selected.canvas}
          goalTarget={goalTarget}
          onGoalTarget={setGoalTarget}
          onAdd={() => undefined}
          edit={selected}
          onSave={(patch, m) => {
            if (m) comp.registerMedia(selected.sid, m.el, m.url); // references share the sid, so they switch too
            patchSource(selected.id, patch);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'shape' && selected && <ShapeDialog source={selected} onPatch={(p) => patchSource(selected.id, p)} onClose={() => setDialog(null)} />}
      {dialog === 'filters' && selected && <FiltersDialog source={selected} onPatch={(p) => patchSource(selected.id, p)} onClose={() => setDialog(null)} />}
      {menu && <SourceMenu x={menu.x} y={menu.y} source={editing?.sources.find((x) => x.id === menu.id) ?? null} canPaste={!!clip} displays={displays} onAct={(a) => act(a, menu.id)} onClose={() => setMenu(null)} />}
      {live.summary && !dialog && <SummaryDialog s={live.summary} onClose={() => live.setSummary(null)} />}
    </div>
  );
}

type Boot = { kind: 'loading' } | { kind: 'signin' } | { kind: 'gate'; me: Me; status: CreatorStatus } | { kind: 'studio'; me: Me };

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [showSettings, setShowSettings] = useState(false);

  const enter = useCallback(async (me: Me) => {
    const status = await api<CreatorStatus>('GET', '/v1/creator/status').catch(() => null);
    if (status?.status === 'approved') setBoot({ kind: 'studio', me });
    else setBoot({ kind: 'gate', me, status: status ?? { status: 'none', studioIngestApproved: false, guideCompleted: false, decisionReason: null, applicationsOpen: true } });
  }, []);

  useEffect(() => {
    void call<Settings>(bridge().getSettings()).then(setSettings);
    bridge()
      .session()
      .then((r) => (r.ok ? enter(r.data) : setBoot({ kind: 'signin' })), () => setBoot({ kind: 'signin' }));
  }, [enter]);

  const signOut = async () => {
    await bridge().logout();
    setBoot({ kind: 'signin' });
  };
  let view = <div className="auth" />;
  if (settings && boot.kind === 'signin') view = <SignIn apiBase={settings.apiBase} onSignedIn={(me) => void enter(me)} onSettings={() => setShowSettings(true)} />;
  if (settings && boot.kind === 'gate') view = <NotCreator me={boot.me} status={boot.status} onSignOut={() => void signOut()} onRefresh={() => void enter(boot.me)} />;
  if (settings && boot.kind === 'studio') view = <Studio me={boot.me} settings={settings} onSignOut={() => void signOut()} />;

  return (
    <>
      {view}
      {showSettings && settings && <SettingsDialog settings={settings} isLive={false} onClose={() => setShowSettings(false)} />}
    </>
  );
}
