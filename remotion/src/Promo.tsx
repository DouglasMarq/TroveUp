import {AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

const C = {
  bg: '#0e1320',
  panel: '#1a2338',
  panelAlt: '#141b2d',
  border: '#29334e',
  text: '#e8ecf4',
  muted: '#8b94a9',
  accent: '#f2b134',
  accentText: '#241a05',
  success: '#46b978',
  info: '#4f8ef7',
  danger: '#e05656',
};

const font = '"Segoe UI", system-ui, -apple-system, sans-serif';

const fade = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 800px at 75% -10%, #1c2740 0%, ${C.bg} 60%)`,
    }}
  />
);

const LogoMark: React.FC<{size: number}> = ({size}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.22,
      background: `linear-gradient(145deg, ${C.accent}, #d99020)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 12px 40px rgba(242,177,52,0.35)',
    }}
  >
    <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke={C.accentText} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  </div>
);

const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const sub = fade(frame, 14, 28);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: font}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 36, transform: `scale(${0.8 + pop * 0.2})`, opacity: pop}}>
        <LogoMark size={150} />
        <div>
          <div style={{fontSize: 110, fontWeight: 800, color: C.text, letterSpacing: -2}}>
            Trove<span style={{color: C.accent}}>Up</span>
          </div>
          <div style={{fontSize: 34, color: C.muted, marginTop: 4, opacity: sub}}>
            Mod manager for Trove · powered by Trovesaurus
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Panel: React.FC<{children: React.ReactNode; title: string}> = ({children, title}) => (
  <div
    style={{
      width: 1500,
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      overflow: 'hidden',
      boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
      fontFamily: font,
    }}
  >
    <div style={{display: 'flex', gap: 10, padding: '16px 22px', background: C.panelAlt, borderBottom: `1px solid ${C.border}`}}>
      {['#e05656', '#f2b134', '#46b978'].map((c) => (
        <div key={c} style={{width: 16, height: 16, borderRadius: 8, background: c}} />
      ))}
      <div style={{marginLeft: 16, color: C.muted, fontSize: 22}}>TroveUp — {title}</div>
    </div>
    <div style={{padding: 30}}>{children}</div>
  </div>
);

const Tabs: React.FC<{active: string}> = ({active}) => {
  const tabs = ['My Mods', 'Get More Mods', 'Mod Packs', 'Modder Tools'];
  return (
    <div style={{display: 'flex', gap: 14, marginBottom: 26}}>
      {tabs.map((t) => (
        <div
          key={t}
          style={{
            padding: '12px 26px',
            borderRadius: 10,
            fontSize: 24,
            fontWeight: 600,
            color: t === active ? C.accentText : C.text,
            background: t === active ? C.accent : C.panelAlt,
            border: `1px solid ${t === active ? C.accent : C.border}`,
          }}
        >
          {t}
        </div>
      ))}
    </div>
  );
};

const mods = [
  {name: 'BetterUI', author: 'shiroki', version: '2.4.1'},
  {name: 'VoxelFX+', author: 'duskcraft', version: '1.9.0'},
  {name: 'DragonMounts', author: 'emberly', version: '3.2.0'},
  {name: 'LootTracker', author: 'quill', version: '0.8.5'},
];

const MyModsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18}});
  const install = fade(frame, 40, 55);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div style={{transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter}}>
        <Panel title="My Mods">
          <Tabs active="My Mods" />
          <div>
            <div style={{display: 'grid', gridTemplateColumns: '120px 1.6fr 1fr 0.6fr 0.9fr', padding: '12px 18px', color: C.muted, fontSize: 22, borderBottom: `1px solid ${C.border}`}}>
              <div>Enabled</div><div>Name</div><div>Author</div><div>Version</div><div>Status</div>
            </div>
            {mods.map((m, i) => {
              const rowIn = spring({frame: frame - 8 - i * 5, fps, config: {damping: 16}});
              const updated = i === 0 && install > 0.5;
              return (
                <div
                  key={m.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1.6fr 1fr 0.6fr 0.9fr',
                    padding: '16px 18px',
                    fontSize: 25,
                    color: C.text,
                    borderBottom: `1px solid ${C.border}`,
                    opacity: rowIn,
                    transform: `translateX(${(1 - rowIn) * 30}px)`,
                    background: i === 0 && install > 0 ? `rgba(70,185,120,${0.12 * install})` : 'transparent',
                  }}
                >
                  <div style={{color: C.success, fontWeight: 700}}>✓</div>
                  <div style={{fontWeight: 600}}>{m.name}</div>
                  <div style={{color: C.muted}}>{m.author}</div>
                  <div>{m.version}</div>
                  <div style={{color: updated ? C.success : C.info, fontWeight: 600}}>
                    {updated ? 'Up To Date' : i === 0 ? 'Installing…' : 'Up To Date'}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </AbsoluteFill>
  );
};

const browse = [
  {name: 'SkyRealm Biomes', votes: '1.2k', dl: '48k'},
  {name: 'Neon City Blocks', votes: '980', dl: '36k'},
  {name: 'Costume Vault', votes: '870', dl: '29k'},
  {name: 'Pet Companions', votes: '760', dl: '22k'},
];

const GetMoreScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18}});
  const typing = 'dragon'.slice(0, Math.max(0, Math.floor((frame - 8) / 3)));
  const progress = interpolate(frame, [30, 58], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div style={{transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter}}>
        <Panel title="Get More Mods">
          <Tabs active="Get More Mods" />
          <div style={{display: 'flex', gap: 14, marginBottom: 24}}>
            <div style={{flex: 1, padding: '14px 22px', fontSize: 24, background: C.panelAlt, border: `1px solid ${C.accent}`, borderRadius: 10, color: C.text, boxShadow: `0 0 0 4px rgba(242,177,52,0.25)`}}>
              {typing}<span style={{opacity: frame % 20 < 10 ? 1 : 0}}>|</span>
            </div>
            <div style={{padding: '14px 28px', fontSize: 24, fontWeight: 700, background: C.accent, color: C.accentText, borderRadius: 10}}>Search</div>
          </div>
          {browse.map((m, i) => {
            const rowIn = spring({frame: frame - 18 - i * 4, fps, config: {damping: 16}});
            const installing = i === 0 && progress > 0;
            return (
              <div key={m.name} style={{display: 'flex', alignItems: 'center', gap: 24, padding: '18px', borderBottom: `1px solid ${C.border}`, opacity: rowIn, transform: `translateX(${(1 - rowIn) * 30}px)`}}>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 26, fontWeight: 600, color: C.text}}>{m.name}</div>
                  <div style={{fontSize: 20, color: C.muted}}>★ {m.votes} · ⬇ {m.dl} downloads</div>
                  {installing && (
                    <div style={{marginTop: 8, height: 8, width: 420, background: C.panelAlt, borderRadius: 4, overflow: 'hidden'}}>
                      <div style={{height: '100%', width: `${progress * 100}%`, background: C.accent, borderRadius: 4}} />
                    </div>
                  )}
                </div>
                <div style={{padding: '12px 30px', fontSize: 23, fontWeight: 700, borderRadius: 10, background: installing && progress >= 1 ? C.success : C.accent, color: installing && progress >= 1 ? '#06170d' : C.accentText}}>
                  {installing ? (progress >= 1 ? 'Installed ✓' : `${Math.round(progress * 100)}%`) : 'Install'}
                </div>
              </div>
            );
          })}
        </Panel>
      </div>
    </AbsoluteFill>
  );
};

const features = [
  'One-click installs from Trovesaurus',
  'Automatic mod updates',
  'Create & share mod packs',
  'trove:// deep links',
  'Built-in modder tools',
  'System tray & auto-updater',
];

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 14}});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: font}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 26, transform: `scale(${0.85 + pop * 0.15})`, opacity: pop}}>
        <LogoMark size={90} />
        <div style={{fontSize: 72, fontWeight: 800, color: C.text}}>
          Trove<span style={{color: C.accent}}>Up</span>
        </div>
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center', maxWidth: 1300, marginTop: 46}}>
        {features.map((f, i) => {
          const s = spring({frame: frame - 10 - i * 4, fps, config: {damping: 15}});
          return (
            <div key={f} style={{padding: '16px 30px', fontSize: 27, fontWeight: 600, color: C.text, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 999, opacity: s, transform: `translateY(${(1 - s) * 24}px)`}}>
              <span style={{color: C.accent, marginRight: 10}}>◆</span>{f}
            </div>
          );
        })}
      </div>
      <div style={{marginTop: 44, fontSize: 30, color: C.muted, opacity: fade(frame, 40, 55)}}>
        github.com/DouglasMarq/TroveUp
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={0} durationInFrames={60}>
        <TitleScene />
      </Sequence>
      <Sequence from={60} durationInFrames={90}>
        <MyModsScene />
      </Sequence>
      <Sequence from={150} durationInFrames={80}>
        <GetMoreScene />
      </Sequence>
      <Sequence from={230} durationInFrames={70}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};
