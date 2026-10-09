import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { ACTIONS, framePath, selectActions } from '../shared/actions';
import type { AppState, DraftImage } from '../shared/desktop';

const labels = { online: '在线', offline: '不在线', busy: '忙碌' };
type Panel = 'menu' | 'composer' | 'status' | 'size' | null;
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
  const [frame, setFrame] = useState(0),
    [action, setAction] = useState('doze');
  const [text, setText] = useState(''),
    [pairCode, setPairCode] = useState(''),
    [relayUrl, setRelayUrl] = useState('');
  const [draft, setDraft] = useState<DraftImage | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null),
    [bubble, setBubble] = useState(false),
    [connectionSettings, setConnectionSettings] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null),
    alphaRef = useRef<ImageData | null>(null),
    drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const interactive = useRef(false),
    lastMessage = useRef(''),
    oldCode = useRef('');
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
      setState(next);
      if (oldCode.current && next.code !== oldCode.current) {
        setText('');
        setDraft(null);
        setPreview(null);
        setBubble(false);
      }
      oldCode.current = next.code;
      const latest = next.messages.at(-1);
      if (latest && latest.id !== lastMessage.current) {
        lastMessage.current = latest.id;
        if (latest.direction === 'in') setBubble(true);
      }
    };
    window.pet.getState().then((next) => {
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
  useEffect(() => {
    window.pet?.setExpanded(!!panel || !!preview || bubble);
  }, [panel, preview, bubble]);
  const disabledKey = state?.preferences.disabledActions.join(',') || '';
  useEffect(() => {
    const choices = selectActions(
      state?.effective || 'offline',
      state?.preferences.disabledActions || [],
    );
    let index = 0,
      tick = 0;
    const selected = choices[0];
    setAction(selected?.id || 'sway');
    setFrame(0);
    if (!selected || reducedMotion || panel) return;
    const timer = setInterval(() => {
      const current = choices[index];
      tick++;
      setFrame(Math.floor((tick * current.fps) / 30) % current.frames);
      if (tick >= 30 * 8) {
        index = (index + 1) % choices.length;
        tick = 0;
        setAction(choices[index].id);
        setFrame(0);
      }
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, [state?.effective, disabledKey, reducedMotion, panel]);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      let active = !!target.closest('[data-interactive]') || !!drag.current;
      const img = imageRef.current,
        alpha = alphaRef.current;
      if (!active && img && alpha) {
        const rect = img.getBoundingClientRect(),
          x = Math.floor(((event.clientX - rect.left) * alpha.width) / rect.width),
          y = Math.floor(((event.clientY - rect.top) * alpha.height) / rect.height);
        if (x >= 0 && y >= 0 && x < alpha.width && y < alpha.height)
          active = alpha.data[(y * alpha.width + x) * 4 + 3] > 25;
      }
      if (active !== interactive.current) {
        interactive.current = active;
        window.pet?.setInteractive(active);
      }
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);
  const loadAlpha = () => {
    const img = imageRef.current;
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      alphaRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
  };
  function onDrag(event: PointerEvent<HTMLImageElement>) {
    if (!drag.current) return;
    const dx = event.screenX - drag.current.x,
      dy = event.screenY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
    window.pet.moveBy(dx, dy);
    drag.current.x = event.screenX;
    drag.current.y = event.screenY;
  }
  const toggle = (target: Panel) => {
    setError('');
    setPanel((previous) => (previous === target ? null : target));
  };
  const latest = state?.messages.filter((message) => message.direction === 'in').at(-1);
  const canSend = state?.effective === 'online' && state.own === 'online';
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
  if (!state)
    return (
      <div className="boot" data-interactive>
        {error || '铃宝正在醒来…'}
      </div>
    );
  const scale = state.preferences.scale;
  const style = {
    '--scale': scale,
    '--pet-width': `${Math.max(360, 416 * scale + 24)}px`,
  } as CSSProperties;
  return (
    <main className={`stage dock-${state.dock}`} style={style}>
      <div className="pet-zone">
        <div
          className={`presence ${state.effective}`}
          data-interactive
          title={`自己：${labels[state.own]} · 对方：${labels[state.peer]}`}
        >
          <span className="status-dot" />
          {labels[state.effective]}
          <span className="presence-detail">{state.paired ? '已配对' : '等待配对'}</span>
        </div>
        <img
          ref={imageRef}
          className="pet"
          src={framePath(action, frame)}
          alt={`铃宝：${ACTIONS.find((a) => a.id === action)?.name}`}
          draggable={false}
          onLoad={loadAlpha}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { x: e.screenX, y: e.screenY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={onDrag}
          onPointerUp={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onDoubleClick={() => {
            setBubble(false);
            toggle('composer');
          }}
        />
        <nav className="toolbar" aria-label="桌宠操作" data-interactive>
          <button className={panel === 'status' ? 'selected' : ''} onClick={() => toggle('status')}>
            <Icon name="status" />
            <span>状态</span>
          </button>
          <button className={panel === 'menu' ? 'selected' : ''} onClick={() => toggle('menu')}>
            <Icon name="menu" />
            <span>菜单</span>
          </button>
          <button className={panel === 'size' ? 'selected' : ''} onClick={() => toggle('size')}>
            <Icon name="size" />
            <span>调整大小</span>
          </button>
          <button
            className={state.preferences.alwaysOnTop ? 'selected' : ''}
            aria-pressed={state.preferences.alwaysOnTop}
            onClick={() =>
              run(() => window.pet.setPreferences({ alwaysOnTop: !state.preferences.alwaysOnTop }))
            }
          >
            <Icon name="pin" />
            <span>{state.preferences.alwaysOnTop ? '已置顶' : '置顶'}</span>
          </button>
        </nav>
      </div>
      {panel && (
        <section
          className="floating-panel"
          data-interactive
          aria-label={
            panel === 'menu'
              ? '桌宠菜单'
              : panel === 'composer'
                ? '聊天输入框'
                : panel === 'status'
                  ? '选择状态'
                  : '调整大小'
          }
        >
          <header>
            <div>
              <span className="eyebrow">铃宝 · 陪在这里</span>
              <h1>
                {panel === 'menu'
                  ? '小小控制室'
                  : panel === 'composer'
                    ? '说点什么吧'
                    : panel === 'status'
                      ? '现在是什么状态？'
                      : '刚刚好的大小'}
              </h1>
            </div>
            <button className="icon-button" aria-label="关闭弹窗" onClick={() => setPanel(null)}>
              <Icon name="close" />
            </button>
          </header>
          <div className="panel-body">
            {panel === 'status' && (
              <>
                <p className="subtle">双方都在线，才会开启对话。</p>
                <div className="status-options">
                  {(['online', 'busy'] as const).map((choice) => (
                    <button
                      key={choice}
                      className={`status-choice ${state.own === choice ? 'active' : ''}`}
                      aria-pressed={state.own === choice}
                      onClick={() => run(() => window.pet.setStatus(choice))}
                    >
                      <span className={`status-dot ${choice}`} />
                      <div>
                        <strong>{labels[choice]}</strong>
                        <small>
                          {choice === 'online' ? '可以找我聊天' : '先专注一下，暂停收发'}
                        </small>
                      </div>
                      {state.own === choice && <span className="check">✓</span>}
                    </button>
                  ))}
                </div>
                <div className="hint">对方目前：{labels[state.peer]}</div>
              </>
            )}
            {panel === 'size' && (
              <>
                <p className="subtle">调整桌宠大小，不改变图片比例。</p>
                <div className="size-options">
                  {[0.75, 1, 1.25, 1.5].map((value) => (
                    <button
                      key={value}
                      className={scale === value ? 'active' : ''}
                      aria-pressed={scale === value}
                      onClick={() => run(() => window.pet.setPreferences({ scale: value }))}
                    >
                      {value * 100}%
                    </button>
                  ))}
                </div>
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
                    <span className={`status-dot ${state.effective}`} />
                    {state.notice}
                  </p>
                </section>
                <section className="settings-section">
                  <div className="section-title">
                    <h2>动作偏好</h2>
                    <span>勾选即停用</span>
                  </div>
                  <div className="action-list">
                    {ACTIONS.map((item, index) => (
                      <label className="action-row" key={item.id}>
                        <span className="action-number">0{index + 1}</span>
                        <span>{item.name}</span>
                        <input
                          type="checkbox"
                          checked={state.preferences.disabledActions.includes(item.id)}
                          aria-label={`禁用${item.name}`}
                          onChange={(e) =>
                            run(() =>
                              window.pet.setPreferences({
                                disabledActions: e.target.checked
                                  ? [...state.preferences.disabledActions, item.id]
                                  : state.preferences.disabledActions.filter(
                                      (id) => id !== item.id,
                                    ),
                              }),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {state.preferences.disabledActions.length === 6 && (
                    <small className="subtle">所有动作已停用，保留静态陪伴。</small>
                  )}
                </section>
                <section className="settings-section">
                  <label className="switch-row">
                    <div>
                      <strong>开机自启</strong>
                      <small>启动桌宠，配对仍需手动进行</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={state.preferences.autoStart}
                      onChange={(e) =>
                        run(() => window.pet.setPreferences({ autoStart: e.target.checked }))
                      }
                    />
                  </label>
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
            {panel === 'composer' && (
              <>
                <div className="chat-status">
                  <span className={`status-dot ${state.effective}`} />
                  {canSend
                    ? '两个人都在，放心说吧'
                    : state.effective === 'busy'
                      ? '忙碌中，草稿会为你保留'
                      : '等待双方在线后发送'}
                </div>
                <div className="messages" aria-label="本次会话消息" aria-live="polite">
                  {state.messages.length === 0 ? (
                    <div className="empty-chat">
                      <Icon name="send" size={28} />
                      <p>打个招呼，让陪伴开始。</p>
                      <small>文字、图片，或者一张截图。</small>
                    </div>
                  ) : (
                    state.messages.slice(-12).map((message) => (
                      <article key={message.id} className={`message ${message.direction}`}>
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
                            <img src={message.image} alt="聊天图片" />
                          </button>
                        )}
                        <small>
                          {new Date(message.time).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {message.direction === 'out' &&
                            ` · ${message.delivery === 'delivered' ? '已送达' : message.delivery === 'sending' ? '发送中' : '未确认送达'}`}
                        </small>
                      </article>
                    ))
                  )}
                </div>
                {draft && (
                  <div className="draft-image">
                    <img src={draft.dataUrl} alt="待发送图片" />
                    <span>
                      {draft.width} × {draft.height}
                      <small>{(draft.bytes / 1024).toFixed(0)} KB</small>
                    </span>
                    <button
                      className="icon-button"
                      aria-label="移除待发送图片"
                      onClick={() => setDraft(null)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="消息内容"
                  placeholder="想说的话，写在这里…"
                  value={text}
                  maxLength={4000}
                  rows={3}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    if ([...e.clipboardData.items].some((item) => item.type.startsWith('image/'))) {
                      e.preventDefault();
                      void run(async () => setDraft(await window.pet.pasteImage()));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <button
                    className="icon-button"
                    aria-label="选择图片"
                    title="选择图片，也可以 Ctrl+V 粘贴截图"
                    onClick={() =>
                      run(async () => {
                        const image = await window.pet.chooseImage();
                        if (image) setDraft(image);
                      })
                    }
                  >
                    <Icon name="image" />
                  </button>
                  <span>Ctrl + Enter 发送</span>
                  <button
                    className="primary send"
                    disabled={!canSend || busy || (!text.trim() && !draft)}
                    onClick={send}
                  >
                    发送
                    <Icon name="send" size={16} />
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      )}
      {!panel && bubble && latest && (
        <section className="floating-panel notification" data-interactive>
          <header>
            <strong>对方捎来一条消息</strong>
            <button className="icon-button" aria-label="收起消息" onClick={() => setBubble(false)}>
              <Icon name="close" />
            </button>
          </header>
          {latest.kind === 'text' ? (
            <p>{latest.text}</p>
          ) : (
            <button className="message-image" onClick={() => setPreview(latest.image!)}>
              <img src={latest.image} alt="收到的图片" />
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              setBubble(false);
              setPanel('composer');
            }}
          >
            打开对话
          </button>
        </section>
      )}
      {preview && (
        <div className="preview" data-interactive role="dialog" aria-label="图片预览">
          <button
            className="icon-button"
            aria-label="关闭图片预览"
            onClick={() => setPreview(null)}
          >
            <Icon name="close" />
          </button>
          <img src={preview} alt="聊天图片预览" />
        </div>
      )}
    </main>
  );
}
