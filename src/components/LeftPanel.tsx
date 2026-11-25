import { useEffect, useRef, useState } from 'react';
import type { Orientation, Scene, Source, SourceKind } from '../lib/scene';
import { Icon, type IconName } from './Icon';

export const KIND_ICON: Record<SourceKind, IconName> = {
  game: 'game', display: 'display', window: 'window', camera: 'camera', image: 'image', text: 'text', video: 'film',
  alert: 'alert', goal: 'target', chatbox: 'chat', countdown: 'timer', tally: 'hash', ranking: 'users',
};

export type View = 'studio' | 'mobile';
export type Layout = Orientation | 'both';
export type Tool = 'goal' | 'ranking' | 'obs';

type Props = {
  view: View;
  setView: (v: View) => void;
  director: boolean;
  setDirector: (d: boolean) => void;
  layout: Layout;
  setLayout: (l: Layout) => void;
  isLive: boolean;
  mainOrientation: Orientation;
  scenes: Scene[];
  editingId: string;
  programId: string;
  previewId: string | null;
  onSelectScene: (id: string) => void;
  onAddScene: () => void;
  onRenameScene: (id: string, name: string) => void;
  onDeleteScene: (id: string) => void;
  canvases: Orientation[];
  selectedId: string | null;
  onSelectSource: (id: string) => void;
  onPatchSource: (id: string, patch: Partial<Source>) => void;
  onRemoveSource: (id: string) => void;
  onMoveSource: (id: string, dir: 1 | -1) => void;
  onAddSource: (canvas: Orientation) => void;
  onTool: (t: Tool) => void;
  renameId: string | null; // source being renamed inline
  onRenameSource: (id: string | null) => void;
  onContext: (x: number, y: number, id: string | null) => void;
};

function ViewMenu({ view, setView, director, setDirector }: Pick<Props, 'view' | 'setView' | 'director' | 'setDirector'>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost" style={{ padding: '0 8px', marginLeft: -8, fontWeight: 600 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        {view === 'studio' ? 'Studio view' : 'Mobile view'}
        {director && <span className="tag prev">Director</span>}
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="pop left" style={{ minWidth: 250 }}>
          {(['studio', 'mobile'] as const).map((v) => (
            <button key={v} className="item" onClick={() => (setView(v), setOpen(false))}>
              <Icon name={v === 'studio' ? 'monitor' : 'phone'} />
              {v === 'studio' ? 'Studio view' : 'Mobile view'}
              {view === v && <span className="end"><Icon name="check" /></span>}
            </button>
          ))}
          <hr />
          <button className="item" role="switch" aria-checked={director} onClick={() => setDirector(!director)}>
            <Icon name="layers" />
            <span style={{ display: 'grid' }}>
              Director mode
              <span className="faint" style={{ fontSize: 12 }}>Preview the next scene before it goes out</span>
            </span>
            <span className="end switch" aria-checked={director} />
          </button>
        </div>
      )}
    </div>
  );
}

function SceneRow({ scene, sel, isProgram, isPreview, canDelete, onSelect, onRename, onDelete }: { scene: Scene; sel: boolean; isProgram: boolean; isPreview: boolean; canDelete: boolean; onSelect: () => void; onRename: (n: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scene.name);
  const commit = () => {
    setEditing(false);
    if (name.trim()) onRename(name.trim().slice(0, 40));
    else setName(scene.name);
  };
  return (
    <div className={`row${sel ? ' sel' : ''}`} onClick={onSelect} onDoubleClick={() => setEditing(true)}>
      {editing ? (
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} onClick={(e) => e.stopPropagation()} aria-label="Scene name" />
      ) : (
        <span className="name">{scene.name}</span>
      )}
      {isProgram && <span className="tag live">On air</span>}
      {isPreview && !isProgram && <span className="tag prev">Preview</span>}
      {!editing && (
        <span className="acts">
          <button className="icon-btn" aria-label={`Rename ${scene.name}`} onClick={(e) => (e.stopPropagation(), setEditing(true))}>
            <Icon name="pencil" size={14} />
          </button>
          <button className="icon-btn" aria-label={`Delete ${scene.name}`} disabled={!canDelete} title={canDelete ? undefined : isProgram ? 'This scene is on air' : 'Keep at least one scene'} onClick={(e) => (e.stopPropagation(), onDelete())}>
            <Icon name="trash" size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

type RowProps = {
  s: Source;
  sel: boolean;
  first: boolean;
  last: boolean;
  renaming: boolean;
  onSelect: () => void;
  onPatch: (p: Partial<Source>) => void;
  onRemove: () => void;
  onMove: (d: 1 | -1) => void;
  onRename: (on: boolean) => void;
  onContext: (x: number, y: number) => void;
};

function SourceRow({ s, sel, first, last, renaming, onSelect, onPatch, onRemove, onMove, onRename, onContext }: RowProps) {
  const [name, setName] = useState(s.name);
  useEffect(() => {
    if (renaming) setName(s.name);
  }, [renaming, s.name]);
  const commit = (keep: boolean) => {
    if (keep && name.trim() && name.trim() !== s.name) onPatch({ name: name.trim().slice(0, 40) });
    onRename(false);
  };
  const stop = (fn: () => void) => (e: React.MouseEvent) => (e.stopPropagation(), fn());
  return (
    <div
      className={`row${sel ? ' sel' : ''}${s.visible ? '' : ' hidden'}`}
      onClick={onSelect}
      onDoubleClick={() => onRename(true)}
      onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), onSelect(), onContext(e.clientX, e.clientY))}
    >
      <Icon name={KIND_ICON[s.kind]} size={14} />
      {renaming ? (
        <input
          className="input"
          value={name}
          autoFocus
          maxLength={40}
          aria-label="Source name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit(true)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => (e.key === 'Enter' ? commit(true) : e.key === 'Escape' && (e.stopPropagation(), commit(false)))}
        />
      ) : (
        <span className="name">{s.name}</span>
      )}
      {s.locked && !renaming && <Icon name="lock" size={12} />}
      {!renaming && (
        <span className="acts over">
          <button className="icon-btn" aria-label={s.visible ? `Hide ${s.name}` : `Show ${s.name}`} onClick={stop(() => onPatch({ visible: !s.visible }))}>
            <Icon name={s.visible ? 'eye' : 'eyeOff'} size={14} />
          </button>
          <button className="icon-btn" aria-label={s.locked ? `Unlock ${s.name}` : `Lock ${s.name}`} onClick={stop(() => onPatch({ locked: !s.locked }))}>
            <Icon name={s.locked ? 'lock' : 'unlock'} size={14} />
          </button>
          <button className="icon-btn" aria-label={`Move ${s.name} up`} disabled={first} onClick={stop(() => onMove(1))}>
            <Icon name="up" size={14} />
          </button>
          <button className="icon-btn" aria-label={`Move ${s.name} down`} disabled={last} onClick={stop(() => onMove(-1))}>
            <Icon name="down" size={14} />
          </button>
          <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={stop(onRemove)}>
            <Icon name="trash" size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

export function LeftPanel(p: Props) {
  const editing = p.scenes.find((s) => s.id === p.editingId);
  return (
    <aside className="panel left">
      <div className="sec" style={{ paddingBlock: 8 }}>
        <ViewMenu view={p.view} setView={p.setView} director={p.director} setDirector={p.setDirector} />
        {p.view === 'studio' && (
          <div className="seg" role="group" aria-label="Layout" style={{ marginTop: 6 }}>
            {(['portrait', 'landscape', 'both'] as const).map((l) => (
              <button key={l} aria-pressed={p.layout === l} disabled={p.isLive && l !== 'both' && l !== p.mainOrientation} title={p.isLive && l !== 'both' && l !== p.mainOrientation ? 'Orientation is fixed while you’re LIVE' : undefined} onClick={() => p.setLayout(l)}>
                {l === 'portrait' ? 'Portrait' : l === 'landscape' ? 'Landscape' : 'Both'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <section className="sec">
          <div className="sec-h">
            <h2>Scenes</h2>
            <button className="icon-btn" aria-label="Add scene" onClick={p.onAddScene}>
              <Icon name="plus" />
            </button>
          </div>
          <div className="rows">
            {p.scenes.map((sc) => (
              <SceneRow
                key={sc.id}
                scene={sc}
                sel={sc.id === p.editingId}
                isProgram={sc.id === p.programId}
                isPreview={sc.id === p.previewId}
                canDelete={p.scenes.length > 1 && sc.id !== p.programId}
                onSelect={() => p.onSelectScene(sc.id)}
                onRename={(n) => p.onRenameScene(sc.id, n)}
                onDelete={() => p.onDeleteScene(sc.id)}
              />
            ))}
          </div>
        </section>
        <section className="sec sources" style={{ borderBottom: 0 }} tabIndex={-1} aria-label="Sources" onContextMenu={(e) => (e.preventDefault(), p.onContext(e.clientX, e.clientY, null))}>
          <div className="sec-h">
            <h2>Sources</h2>
            <button className="btn sm" onClick={() => p.onAddSource(p.canvases[0]!)}>
              <Icon name="plus" size={14} /> Add source
            </button>
          </div>
          {p.canvases.map((o) => {
            const list = (editing?.sources ?? []).filter((s) => s.canvas === o).reverse(); // top of the stack first
            return (
              <div key={o}>
                {p.canvases.length > 1 && (
                  <div className="sub-h">
                    <span>{o === 'portrait' ? 'Portrait' : 'Landscape'}</span>
                    <button className="link" style={{ fontSize: 12, textDecoration: 'none', color: 'var(--faint)' }} onClick={() => p.onAddSource(o)}>
                      + Add
                    </button>
                  </div>
                )}
                {list.length ? (
                  <div className="rows">
                    {list.map((s, i) => (
                      <SourceRow
                        key={s.id}
                        s={s}
                        sel={s.id === p.selectedId}
                        first={i === 0}
                        last={i === list.length - 1}
                        renaming={p.renameId === s.id}
                        onSelect={() => p.onSelectSource(s.id)}
                        onPatch={(patch) => p.onPatchSource(s.id, patch)}
                        onRemove={() => p.onRemoveSource(s.id)}
                        onMove={(d) => p.onMoveSource(s.id, d)}
                        onRename={(on) => p.onRenameSource(on ? s.id : null)}
                        onContext={(x, y) => p.onContext(x, y, s.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">No {o} sources in {editing?.name ?? 'this scene'}. Add a camera, game, image or text.</div>
                )}
              </div>
            );
          })}
        </section>
      </div>
      <section className="sec" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
        <div className="sec-h">
          <h2>Tools</h2>
        </div>
        <div className="tools">
          <button className="tool" onClick={() => p.onTool('goal')}>
            <Icon name="target" size={18} /> LIVE Goal
          </button>
          <button className="tool" onClick={() => p.onTool('ranking')}>
            <Icon name="users" size={18} /> Viewer ranking
          </button>
          <button className="tool" onClick={() => p.onTool('obs')}>
            <Icon name="broadcast" size={18} /> Stream with OBS
          </button>
        </div>
      </section>
    </aside>
  );
}
