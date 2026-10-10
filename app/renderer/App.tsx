import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ACTIONS, DEFAULT_DISABLED_ACTIONS, selectActions } from '../shared/actions';
import type { AppState, DraftImage } from '../shared/desktop';
import { usePetAnimation } from './usePetAnimation';
import { Switch } from './Switch';
import { useIncomingBubble } from './useIncomingBubble';
import { useBubbleLayout } from './useBubbleLayout';
import { BUBBLE_INSETS } from '../shared/bubbleLayout';
import { useDesktopLayout } from './useDesktopLayout';
import { dragScale, MIN_SCALE, MAX_SCALE, desktopLayout, PET_TOP } from '../shared/layout';

const labels = { online: '在线', offline: '不在线', busy: '忙碌' };
type Panel = 'menu' | 'status' | 'chat' | 'quick' | null;
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    status: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    size: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z" />
      </>
    ),
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    pin: (
      <>
        <path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    send: (
      <>
        <path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1" />
        <path d="m3 17 6-6 4 4 3-3 5 5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M15 8V3H3v12h5" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 13 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
          transform="translate(0 -1)"
        />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.menu}
    </svg>
  );
}
export function App() {
  const [state, setState] = useState<AppState | null>(null),
    [panel, setPanel] = useState<Panel>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [text, setText] = useState(''),
    [pairCode, setPairCode] = useState(''),
    [relayUrl, setRelayUrl] = useState('');
  const [draft, setDraft] = useState<DraftImage | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null),
    [connectionSettings, setConnectionSettings] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false),
    [resizing, setResizing] = useState(false);
  const incoming = useIncomingBubble(state?.messages || [], state?.code || '');
  const cloud = useBubbleLayout(state?.preferences.scale || 1, incoming.message);
  const { panelRef, bubbleRef, bubbleSize } = useDesktopLayout(
    !!state,
    panel,
    incoming.message?.id || 'idle',
    preview,
    controlsOpen,
  );
  const { canvasRef, alphaRef, viewportSize } = usePetAnimation(
    selectActions(
      state?.effective || 'offline',
      state?.preferences.disabledActions || DEFAULT_DISABLED_ACTIONS,
    ),
    !!state,
    reducedMotion,
    setError,
  );
  const drag = useRef<{ x: number; y: number } | null>(null),
    interactive = useRef(false),
    oldCode = useRef('');
  const inputRef = useRef<HTMLTextAreaElement>(null),
    historyRef = useRef<HTMLDivElement>(null);
  const resizeDrag = useRef<{
    x: number;
    y: number;
    scale: number;
    held: boolean;
    lastX: number;
    lastY: number;
  } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    resizeFrame = useRef(0),
    requestedScale = useRef(1);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!window.pet) {
      setError('请打开铃宝 exe 启动桌宠');
      return;
    }
    const update = (next: AppState) => {
      if (oldCode.current && next.code !== oldCode.current) {
        setText('');
        setDraft(null);
        setPreview(null);
      }
      oldCode.current = next.code;
      setState(next);
    };
    void window.pet.getState().then((next) => {
      update(next);
      setRelayUrl(next.preferences.relayUrl);
    });
    return window.pet.subscribe(update);
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    const changed = () => setReducedMotion(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      cancelAnimationFrame(resizeFrame.current);
    },
    [],
  );
  useEffect(() => {
    if (panel === 'chat' && historyRef.current)
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [panel, state?.messages.length]);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      let active = !!target.closest('[data-interactive]') || !!drag.current || !!resizeDrag.current;
      const canvas = canvasRef.current,
        alpha = alphaRef.current;
      if (!active && canvas && alpha) {
        const r = canvas.getBoundingClientRect();
        const x = alpha.x + Math.floor(((event.clientX - r.left) * canvas.width) / r.width),
          y = alpha.y + Math.floor(((event.clientY - r.top) * canvas.height) / r.height);
        if (x >= 0 && y >= 0 && x < alpha.width && y < alpha.height)
          active = alpha.data[y * alpha.width + x] > 25;
      }
      if (active !== interactive.current) {
        interactive.current = active;
        window.pet?.setInteractive(active);
      }
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);
  const toggle = (target: Panel) => {
    setError('');
    setPanel((current) => (current === target ? null : target));
  };
  const queueScale = (value: number) => {
    requestedScale.current = value;
    if (!resizeFrame.current)
      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = 0;
        window.pet.setScale(requestedScale.current);
      });
  };
  const finishResize = () => {
    clearTimeout(holdTimer.current);
    if (resizeDrag.current?.held) window.pet.setScale(requestedScale.current);
    resizeDrag.current = null;
    setResizing(false);
  };
  const send = () =>
    run(async () => {
      if (draft) {
        await window.pet.sendImage(draft.dataUrl);
        setDraft(null);
      }
      if (text.trim()) {
        await window.pet.sendText(text);
        setText('');
      }
    });
  const openChat = () => {
    incoming.dismiss();
    setPanel('chat');
    setControlsOpen(false);
    setPreview(null);
  };
  const openQuick = () => {
    setControlsOpen(false);
    setPanel((current) => (current === 'quick' ? null : draft ? 'chat' : 'quick'));
  };
  useEffect(() => {
    if (panel === 'chat' || panel === 'quick') inputRef.current?.focus();
  }, [panel, preview]);
  useLayoutEffect(() => {
    if (panel !== 'quick' || !inputRef.current) return;
    inputRef.current.style.height = '26px';
    inputRef.current.style.height = Math.min(44, inputRef.current.scrollHeight + 1) + 'px';
  }, [panel, text]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (preview) setPreview(null);
      else {
        setPanel(null);
        setControlsOpen(false);
      }
    };
    const blur = () => {
      setControlsOpen(false);
      setPanel((current) => (current === 'quick' ? null : current));
    };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [preview]);
  if (!state)
    return (
      <div className="boot" data-interactive>
        {error || '铃宝正在醒来…'}
      </div>
    );
  const scale = state.preferences.scale,
    canSend = state.effective === 'online' && state.own === 'online';
  const layout =
    state.layout ||
    desktopLayout(
      { x: 300, y: 320 },
      scale,
      { panel: null, bubble: null },
      { x: 0, y: 0, width: innerWidth, height: innerHeight },
    ).layout;
  const style = {
    '--scale': scale,
    '--pet-height': Math.round(208 * scale) + 'px',
    '--max-panel-height': layout.maxPanelHeight + 'px',
    '--bubble-ratio': cloud.ratio,
    '--bubble-font': cloud.fontSize + 'px',
    '--bubble-left': BUBBLE_INSETS.left * 100 + '%',
    '--bubble-right': BUBBLE_INSETS.right * 100 + '%',
    '--bubble-top': BUBBLE_INSETS.top * 100 + '%',
    '--bubble-bottom': BUBBLE_INSETS.bottom * 100 + '%',
  } as CSSProperties;
  const panelStyle = {
    left: layout.panel?.x || 0,
    top: layout.panel?.y || 0,
    visibility: layout.panel ? 'visible' : 'hidden',
  } as CSSProperties;
  const chatHint = canSend
    ? 'Enter 发送 · Shift+Enter 换行'
    : state.own === 'busy'
      ? '自己忙碌中，草稿会保留'
      : state.effective === 'busy'
        ? '对方忙碌中，暂停收发'
        : state.paired
          ? '等待对方在线后发送'
          : '先在菜单中与对方配对';
  const composer = (compact: boolean) => (
    <div className={compact ? 'composer-wrap compact-composer' : 'composer-wrap full-composer'}>
      <div className="quick-composer">
        <button
          className="icon-button open-chat"
          aria-label="打开完整聊天窗口"
          title="打开完整聊天窗口"
          onClick={() => {
            incoming.dismiss();
            openChat();
          }}
        >
          <Icon name="history" size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="选择图片"
          title="选择图片，也可以粘贴截图"
          onClick={() =>
            run(async () => {
              const image = await window.pet.chooseImage();
              if (image) {
                setDraft(image);
                setPanel('chat');
              }
            })
          }
        >
          <Icon name="image" size={16} />
        </button>
        {draft && (
          <div
            className="quick-draft"
            title={
              draft.width + ' × ' + draft.height + ' · ' + Math.round(draft.bytes / 1024) + ' KB'
            }
          >
            <img src={draft.dataUrl} alt="待发送图片" />
            <button aria-label="移除待发送图片" onClick={() => setDraft(null)}>
              ×
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          aria-label="消息内容"
          placeholder={compact ? '…' : '写点什么…'}
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if ([...e.clipboardData.items].some((item) => item.type.startsWith('image/'))) {
              e.preventDefault();
              void run(async () => {
                const image = await window.pet.pasteImage();
                if (image) {
                  setDraft(image);
                  setPanel('chat');
                }
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend && !busy && (text.trim() || draft)) void send();
            }
          }}
        />
        <button
          className="quick-send"
          aria-label="发送消息"
          title="发送"
          disabled={!canSend || busy || (!text.trim() && !draft)}
          onClick={send}
        >
          <Icon name="send" size={compact ? 14 : 17} />
        </button>
        {compact && (
          <button
            className="icon-button quick-close"
            aria-label="关闭弹窗"
            title="收起 · Esc"
            onClick={() => setPanel(null)}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      <p
        className={'quick-hint ' + (error ? 'has-error' : '')}
        role={error ? 'alert' : undefined}
        title={error || chatHint}
      >
        {error || chatHint}
      </p>
    </div>
  );
  return (
    <main className="stage" style={style}>
      <div
        className="pet-zone"
        style={{
          left: layout.body.x,
          top: layout.body.y,
          width: layout.body.width,
          height: layout.body.height,
        }}
      >
        <div className="pet-figure">
          <canvas
            ref={canvasRef}
            className="pet"
            role="img"
            aria-label="铃宝：趴姿晃头摆腿"
            draggable={false}
            title="双击打开聊天窗口 · 右键显示状态与菜单"
            onContextMenu={(e) => {
              e.preventDefault();
              setControlsOpen((value) => !value);
              if (controlsOpen && (panel === 'menu' || panel === 'status')) setPanel(null);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              drag.current = { x: e.screenX, y: e.screenY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              window.pet.moveBy(e.screenX - drag.current.x, e.screenY - drag.current.y);
              drag.current = { x: e.screenX, y: e.screenY };
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onDoubleClick={() => {
              incoming.dismiss();
              openChat();
            }}
          />
        </div>
        {controlsOpen && (
          <div
            className="pet-footer"
            data-interactive
            style={{
              left: (layout.controls?.x || 0) - layout.body.x,
              top: (layout.controls?.y || 0) - layout.body.y,
              width: layout.controls?.width || 304,
              visibility: layout.controls ? 'visible' : 'hidden',
            }}
          >
            <nav className="toolbar" aria-label="桌宠操作">
              <button
                className={'presence ' + state.own}
                data-interactive
                onClick={() => toggle('status')}
                title={
                  '自己：' + labels[state.own] + ' · 对方：' + labels[state.peer] + ' · ' + chatHint
                }
                aria-label={'自己的状态：' + labels[state.own]}
              >
                <span className="status-dot" />
                {labels[state.own]}
              </button>
              <button className={panel === 'menu' ? 'selected' : ''} onClick={() => toggle('menu')}>
                <Icon name="menu" />
                <span>菜单</span>
              </button>
              <button
                className={state.preferences.alwaysOnTop ? 'selected' : ''}
                aria-pressed={state.preferences.alwaysOnTop}
                onClick={() =>
                  run(() =>
                    window.pet.setPreferences({ alwaysOnTop: !state.preferences.alwaysOnTop }),
                  )
                }
              >
                <Icon name="pin" />
                <span>{state.preferences.alwaysOnTop ? '已置顶' : '置顶'}</span>
              </button>
              <button
                className="icon-button"
                aria-label="收起操作栏"
                onClick={() => {
                  setControlsOpen(false);
                  if (panel === 'menu' || panel === 'status') setPanel(null);
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </nav>
          </div>
        )}
      </div>
      {controlsOpen && (
        <button
          className={'resize-handle ' + (resizing ? 'resizing' : '')}
          style={{
            left: Math.max(
              0,
              Math.min(
                layout.body.x +
                  layout.body.width / 2 -
                  (Math.round(208 * scale) * viewportSize.width) / viewportSize.height / 2 -
                  8,
                layout.bubble &&
                  layout.bubble.y + layout.bubble.height > layout.body.y + PET_TOP - 8 &&
                  layout.bubble.y < layout.body.y + PET_TOP + 20
                  ? layout.bubble.x - 32
                  : Infinity,
              ),
            ),
            top: layout.body.y + PET_TOP - 8,
          }}
          data-interactive
          role="slider"
          aria-label="按住拖动调整大小"
          aria-valuemin={MIN_SCALE * 100}
          aria-valuemax={MAX_SCALE * 100}
          aria-valuenow={Math.round(scale * 100)}
          aria-valuetext={Math.round(scale * 100) + '%'}
          title="长按小圆点拖动缩放；方向键微调，Home 恢复默认"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            requestedScale.current = scale;
            resizeDrag.current = {
              x: e.screenX,
              y: e.screenY,
              lastX: e.screenX,
              lastY: e.screenY,
              scale,
              held: false,
            };
            holdTimer.current = setTimeout(() => {
              const start = resizeDrag.current;
              if (!start) return;
              start.held = true;
              setResizing(true);
              queueScale(dragScale(start.scale, start.lastX - start.x, start.lastY - start.y));
            }, 180);
          }}
          onPointerMove={(e) => {
            const start = resizeDrag.current;
            if (!start) return;
            start.lastX = e.screenX;
            start.lastY = e.screenY;
            if (start.held)
              queueScale(dragScale(start.scale, e.screenX - start.x, e.screenY - start.y));
          }}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onKeyDown={(e) => {
            if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home'].includes(e.key)) {
              e.preventDefault();
              window.pet.setScale(
                e.key === 'Home'
                  ? 1
                  : scale + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.02 : -0.02),
              );
            }
          }}
        >
          <span />
          {resizing && <output>{Math.round(scale * 100)}%</output>}
        </button>
      )}
      {panel && !preview && (
        <section
          ref={panelRef}
          className={
            'floating-panel ' +
            (panel === 'chat' ? 'chat-panel' : panel === 'quick' ? 'quick-panel' : '')
          }
          data-interactive
          style={panelStyle}
          role="dialog"
          aria-label={
            panel === 'menu'
              ? '桌宠菜单'
              : panel === 'status'
                ? '选择状态'
                : panel === 'quick'
                  ? '快捷聊天'
                  : '聊天窗口'
          }
        >
          {panel !== 'quick' && (
            <header>
              <div>
                <span className="eyebrow">铃宝 · 陪在这里</span>
                <h1>
                  {panel === 'menu' ? '小小控制室' : panel === 'status' ? '我的状态' : '和你聊天'}
                </h1>
              </div>
              <button className="icon-button" aria-label="关闭弹窗" onClick={() => setPanel(null)}>
                <Icon name="close" />
              </button>
            </header>
          )}
          <div className={'panel-body ' + (panel === 'chat' ? 'chat-body' : '')}>
            {panel === 'status' && (
              <>
                <section className="settings-section">
                  <div className="status-toggle-row">
                    <div>
                      <strong>忙碌模式</strong>
                      <small>
                        {state.own === 'busy' ? '先专注一下，暂停收发' : '我在线，可以找我聊天'}
                      </small>
                    </div>
                    <span className={'state-label ' + state.own}>{labels[state.own]}</span>
                    <Switch
                      checked={state.own === 'busy'}
                      label="忙碌模式"
                      onChange={(value) =>
                        void run(() => window.pet.setStatus(value ? 'busy' : 'online'))
                      }
                    />
                  </div>
                  <p className="subtle">对方：{labels[state.peer]} · 双方都在线时才能聊天</p>
                </section>
                <section className="settings-section">
                  <div className="section-title">
                    <h2>动作偏好</h2>
                    <span>滑块亮起即开启</span>
                  </div>
                  <div className="action-list">
                    {ACTIONS.map((item, index) => (
                      <div className="action-row" key={item.id}>
                        <span className="action-number">0{index + 1}</span>
                        <span>{item.name}</span>
                        <Switch
                          checked={!state.preferences.disabledActions.includes(item.id)}
                          label={'启用' + item.name}
                          onChange={(enabled) =>
                            void run(() =>
                              window.pet.setPreferences({
                                disabledActions: enabled
                                  ? state.preferences.disabledActions.filter((id) => id !== item.id)
                                  : [...state.preferences.disabledActions, item.id],
                              }),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                  {state.preferences.disabledActions.length === 6 && (
                    <small className="subtle">所有动作已关闭，保留静态陪伴。</small>
                  )}
                </section>
                <p className="subtle">长按人物左上角的小圆点拖动，即可连续缩放。</p>
              </>
            )}
            {panel === 'menu' && (
              <>
                <section className="settings-section">
                  <div className="section-title">
                    <Icon name="link" />
                    <h2>只属于两个人的连接</h2>
                  </div>
                  {!state.code ? (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => run(() => window.pet.createPair())}
                    >
                      生成我的配对码
                    </button>
                  ) : (
                    <div className="pair-card">
                      <span>{state.paired ? '本次配对' : '我的配对码'}</span>
                      <div>
                        <code>
                          {state.code.slice(0, 5)} {state.code.slice(5)}
                        </code>
                        <button
                          className="icon-button"
                          aria-label="复制配对码"
                          onClick={() => run(() => window.pet.copyCode())}
                        >
                          <Icon name="copy" />
                        </button>
                      </div>
                      <small>
                        {state.paired
                          ? '关闭程序后需要重新配对'
                          : '让另一台电脑输入此码 · 10 分钟有效'}
                      </small>
                    </div>
                  )}
                  {!state.paired && (
                    <div className="pair-input">
                      <label htmlFor="pair-code">输入对方的配对码</label>
                      <div>
                        <input
                          id="pair-code"
                          value={pairCode}
                          maxLength={14}
                          placeholder="10 位配对码"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                        />
                        <button
                          className="primary"
                          disabled={busy || !pairCode.trim()}
                          onClick={() => run(() => window.pet.joinPair(pairCode))}
                        >
                          确认
                        </button>
                      </div>
                    </div>
                  )}
                  {state.code && (
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => run(() => window.pet.cancelPair())}
                    >
                      取消配对
                    </button>
                  )}
                  <p className="connection-note" role="status">
                    <span className={'status-dot ' + state.effective} />
                    {state.notice}
                  </p>
                </section>
                <section className="settings-section">
                  <div className="switch-row">
                    <div>
                      <strong>开机自启</strong>
                      <small>启动桌宠，配对仍需手动进行</small>
                    </div>
                    <Switch
                      checked={state.preferences.autoStart}
                      label="开机自启"
                      onChange={(value) =>
                        void run(() => window.pet.setPreferences({ autoStart: value }))
                      }
                    />
                  </div>
                </section>
                <button
                  className="text-button"
                  aria-expanded={connectionSettings}
                  onClick={() => setConnectionSettings(!connectionSettings)}
                >
                  连接设置
                </button>
                {connectionSettings && (
                  <div className="connection-settings">
                    <label htmlFor="relay-url">中继地址</label>
                    <input
                      id="relay-url"
                      value={relayUrl}
                      onChange={(e) => setRelayUrl(e.target.value)}
                      placeholder="https://…workers.dev"
                    />
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => run(() => window.pet.setPreferences({ relayUrl }))}
                    >
                      保存地址
                    </button>
                  </div>
                )}
                <footer className="menu-footer">
                  <span>本次聊天仅保留在内存</span>
                  <button className="text-button danger" onClick={() => window.pet.quit()}>
                    退出程序
                  </button>
                </footer>
              </>
            )}
            {panel === 'quick' && composer(true)}
            {panel === 'chat' && (
              <>
                <p className="subtle history-note">
                  {labels[state.own]} · 对方{labels[state.peer]} · 记录仅保留在本次运行中
                </p>
                <div
                  ref={historyRef}
                  className="messages"
                  aria-label="本次会话消息"
                  aria-live="polite"
                >
                  {state.messages.length === 0 ? (
                    <div className="empty-chat">
                      <Icon name="send" size={28} />
                      <p>还没有消息</p>
                      <small>在下方写消息，或者点击小气泡快捷回复。</small>
                    </div>
                  ) : (
                    state.messages.map((message) => (
                      <article key={message.id} className={'message ' + message.direction}>
                        <span className="message-name">
                          {message.direction === 'out' ? '我' : '对方'}
                        </span>
                        {message.kind === 'text' ? (
                          <p>{message.text}</p>
                        ) : (
                          <button
                            className="message-image"
                            onClick={() => setPreview(message.image!)}
                            aria-label="查看图片"
                          >
                            <img
                              src={message.image}
                              alt="聊天图片"
                              onLoad={() => {
                                if (message.id === state.messages.at(-1)?.id && historyRef.current)
                                  historyRef.current.scrollTop = historyRef.current.scrollHeight;
                              }}
                            />
                          </button>
                        )}
                        <small>
                          {new Date(message.time).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {message.direction === 'out' &&
                            ' · ' +
                              (message.delivery === 'delivered'
                                ? '已送达'
                                : message.delivery === 'sending'
                                  ? '发送中'
                                  : '未确认送达')}
                        </small>
                      </article>
                    ))
                  )}
                </div>
                {composer(false)}
              </>
            )}
          </div>
        </section>
      )}
      <section
        ref={bubbleRef}
        className={incoming.message ? 'speech-bubble ' + incoming.phase : 'idle-cloud'}
        data-interactive
        aria-label={incoming.message ? '新消息气泡' : '待机小气泡'}
        data-message-id={incoming.message?.id}
        style={{
          left: layout.bubble?.x || 0,
          top: layout.bubble?.y || 0,
          width: cloud.size.width,
          height: cloud.size.height,
          visibility:
            layout.bubble &&
            bubbleSize &&
            layout.bubble.width === bubbleSize.width &&
            layout.bubble.height === bubbleSize.height
              ? 'visible'
              : 'hidden',
        }}
      >
        {incoming.message ? (
          <>
            <button
              className="bubble-surface"
              aria-label="打开快捷聊天"
              title="双击快捷回复"
              onDoubleClick={openQuick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openQuick();
                }
              }}
            >
              <span className="bubble-art mirrored" aria-hidden="true">
                <img src="./ui/speech-bubble.png" alt="" />
              </span>
            </button>
            <button className="bubble-close" aria-label="收起消息气泡" onClick={incoming.dismiss}>
              <Icon name="close" size={13} />
            </button>
            <div
              className="speech-content"
              key={incoming.message.id}
              aria-live="polite"
              onDoubleClick={(e) => {
                e.preventDefault();
                getSelection()?.removeAllRanges();
                openQuick();
              }}
            >
              {incoming.message.kind === 'text' ? (
                <p className="speech-text">{incoming.message.text}</p>
              ) : (
                <p className="image-notice" title="双击人物，在完整聊天窗口查看图片">
                  【图片信息】
                </p>
              )}
            </div>
          </>
        ) : (
          <button
            className="idle-cloud-button"
            aria-label="打开快捷聊天"
            title="双击快捷回复 · 双击人物聊天 · 右键人物设置"
            onDoubleClick={openQuick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openQuick();
              }
            }}
          >
            <img src="./ui/idle-bubble.png" alt="" />
            <span className="idle-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        )}
      </section>
      {preview && (
        <section
          ref={panelRef}
          className="preview"
          data-interactive
          role="dialog"
          aria-label="图片预览"
          style={panelStyle}
        >
          <button
            className="icon-button"
            aria-label="关闭图片预览"
            onClick={() => setPreview(null)}
          >
            <Icon name="close" />
          </button>
          <img src={preview} alt="聊天图片预览" />
        </section>
      )}
    </main>
  );
}
