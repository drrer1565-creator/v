import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  FormField,
  MultilineInput,
  ProgressBar,
  Rows,
  Select,
  Text,
  TextInput,
  Title,
} from '@canva/app-ui-kit';
import { getTemporaryUrl, upload } from '@canva/asset';
import { addElementAtCursor, addElementAtPoint, requestExport } from '@canva/design';
import { useFeatureSupport, useSelection } from '@canva/app-hooks';

type PresetOption = {
  id: string;
  name: string;
  category?: string;
  kind: 'subtitle' | 'scroll' | 'overlay';
};

type CursorOption = {
  id: string;
  emoji: string;
  label: string;
  category: string;
};

type CatalogResponse = {
  ok: boolean;
  subtitles: PresetOption[];
  scrolls: PresetOption[];
  overlays: PresetOption[];
  cursorIcons: CursorOption[];
};

type SourceMode = 'page_export' | 'selected_upload';

const STORAGE_SERVER_KEY = 'videokit_canva_server_url';
const STORAGE_TOKEN_KEY = 'videokit_canva_api_token';

const REVEAL_OPTIONS = [
  { value: 'sentence', label: '按整句 (逐句)' },
  { value: 'word', label: '按单词 (逐词)' },
  { value: 'char', label: '按字符 (逐字)' },
];

const EDGE_VOICES = [
  { value: '', label: '不配音（保留 Canva 页面原声）' },
  { value: 'en-US-AndrewNeural', label: 'Andrew (美式男声 - 深度故事)' },
  { value: 'en-US-AvaNeural', label: 'Ava (美式女声 - 自然清晰)' },
  { value: 'en-US-AriaNeural', label: 'Aria (美式女声 - 祈祷抒情)' },
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (中文女声)' },
  { value: 'zh-CN-YunxiNeural', label: '云希 (中文男声)' },
];

export const App: React.FC = () => {
  const isSupported = useFeatureSupport();
  const videoSelection = useSelection('video');
  const imageSelection = useSelection('image');

  const [serverUrl, setServerUrl] = useState<string>(
    () => localStorage.getItem(STORAGE_SERVER_KEY) || 'https://your-videokit-domain.example.com'
  );
  const [apiToken, setApiToken] = useState<string>(
    () => localStorage.getItem(STORAGE_TOKEN_KEY) || ''
  );
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('page_export');
  const [presetCategory, setPresetCategory] = useState<'scroll' | 'subtitle'>('scroll');
  const [selectedPreset, setSelectedPreset] = useState<string>('sc-39');
  const [revealType, setRevealType] = useState<string>('sentence');
  const [cursorKind, setCursorKind] = useState<string>('cardinal_feather');
  const [edgeVoice, setEdgeVoice] = useState<string>('');
  const [scrollTitle, setScrollTitle] = useState<string>('MORNING PRAYER');
  const [scriptText, setScriptText] = useState<string>(
    'Heavenly Father, thank You for this new day.\nGuide our steps with wisdom and peace.\nAmen.'
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const normalizedServerUrl = useMemo(
    () => String(serverUrl || '').trim().replace(/\/+$/, ''),
    [serverUrl]
  );

  const authHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiToken.trim()) h.Authorization = `Bearer ${apiToken.trim()}`;
    return h;
  }, [apiToken]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SERVER_KEY, serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_TOKEN_KEY, apiToken);
  }, [apiToken]);

  const loadCatalog = async () => {
    setErrorMessage('');
    if (!normalizedServerUrl.startsWith('https://')) {
      setErrorMessage('VideoKit 后端地址必须使用公网 HTTPS（例如 Cloudflare Tunnel 域名）。');
      return;
    }
    try {
      const res = await fetch(`${normalizedServerUrl}/api/canva/presets`, { headers: authHeaders });
      const data = (await res.json()) as CatalogResponse & { error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCatalog(data);
      setStatusMessage(
        `已连接 VideoKit：同步 ${data.scrolls.length} 款滚动风格 / ${data.subtitles.length} 款 T 字幕预设 / ${data.cursorIcons.length} 款光标图标`
      );
    } catch (err) {
      setErrorMessage(`连接 VideoKit 后端失败: ${(err as Error).message}`);
    }
  };

  const presetOptions = useMemo(() => {
    if (!catalog) {
      return presetCategory === 'scroll'
        ? [
            { value: 'sc-39', label: '[sc-39] 🕊️ 祈祷书签绿卡+白鸽玫瑰+逐行金线' },
            { value: 'sc-48', label: '[sc-48] 🪶 三行黑透圆角条+金羽绿字跟读' },
            { value: 'sc-50', label: '[sc-50] 🐦 邮戳牛皮信笺+北美红雀鸟报喜祷告' },
            { value: 'sc-149', label: '[sc-149] 🍷 勃艮第酒红丝绒烫金卡' },
          ]
        : [
            { value: 'sub-245', label: '[sub-245] 🔔 圣诞翡翠绿胶囊_双行白字' },
            { value: 'sub-77', label: '[sub-77] 🪶 三行滚词_金羽绿字跟读' },
            { value: 'sub-228', label: '[sub-228] 🦅 羽毛笔擦除_Shrikhand 经典' },
          ];
    }
    const list = presetCategory === 'scroll' ? catalog.scrolls : catalog.subtitles;
    return list.map((item) => ({
      value: item.id,
      label: `[${item.id}] ${item.name}`,
    }));
  }, [catalog, presetCategory]);

  const cursorOptions = useMemo(() => {
    const base = [{ value: 'none', label: '关闭跟随小图标' }];
    const items = catalog?.cursorIcons || [
      { id: 'cardinal_feather', emoji: '🪶', label: '红雀红褐羽毛', category: '飞羽红雀' },
      { id: 'northern_cardinal', emoji: '🐦', label: '红雀鸟松枝', category: '飞羽红雀' },
      { id: 'cardinal_quill_gold', emoji: '✒️', label: '红雀棕羽金笔', category: '飞羽红雀' },
      { id: 'feather_gold', emoji: '🪶', label: '金色鹅毛笔', category: '经典手写' },
      { id: 'quill', emoji: '🪶', label: '复古羽毛笔', category: '经典手写' },
    ];
    return [...base, ...items.map((it) => ({ value: it.id, label: `${it.emoji} ${it.label}` }))];
  }, [catalog]);

  const acquireSourceUrlFromCanva = async (): Promise<string> => {
    if (sourceMode === 'selected_upload') {
      const vidDraft = await videoSelection.read();
      const vidItem = vidDraft.getItems()[0];
      if (vidItem?.ref) {
        const tmp = await getTemporaryUrl({ type: 'video', ref: vidItem.ref });
        return tmp.url;
      }
      const imgDraft = await imageSelection.read();
      const imgItem = imgDraft.getItems()[0];
      if (imgItem?.ref) {
        const tmp = await getTemporaryUrl({ type: 'image', ref: imgItem.ref });
        return tmp.url;
      }
      throw new Error('请先选中你自己在 Uploads 里上传的视频/图片，或改用“导出当前 Canva 页面（支持官方素材）”。');
    }

    const exported = await requestExport({
      request: {
        acceptedFileTypes: [
          { type: 'video', zipped: 'never' },
          { type: 'png', zipped: 'never' },
        ],
      },
    });
    const firstUrl = exported.urls?.[0];
    if (!firstUrl) {
      throw new Error('Canva 导出未返回可用的文件地址（已取消或当前页面不支持导出）。');
    }
    return firstUrl;
  };

  const handleRenderAndInsert = async () => {
    setErrorMessage('');
    if (!normalizedServerUrl.startsWith('https://')) {
      setErrorMessage('请先填写以 https:// 开头的 VideoKit 公网地址。');
      return;
    }
    if (!scriptText.trim()) {
      setErrorMessage('请输入需要渲染的字幕 / 滚动文案。');
      return;
    }

    setBusy(true);
    setProgress(5);
    setStatusMessage('正在从 Canva 获取当前页面画面...');

    try {
      const sourceUrl = await acquireSourceUrlFromCanva();
      setProgress(20);
      setStatusMessage('已提交给 VideoKit 渲染，请稍候...');

      const startRes = await fetch(`${normalizedServerUrl}/api/canva/render`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          mediaUrl: sourceUrl,
          preset: selectedPreset,
          revealType,
          cursorKind,
          edgeVoice: edgeVoice || undefined,
          scrollTitle: presetCategory === 'scroll' ? scrollTitle.trim() : undefined,
          text: scriptText.trim(),
          width: 720,
          height: 1280,
          fps: 30,
          quality: 'medium',
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error || `提交失败 (HTTP ${startRes.status})`);
      }

      let finalJob = startData;
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const pollRes = await fetch(
          `${normalizedServerUrl}/api/canva/jobs/${encodeURIComponent(startData.jobId)}`,
          { headers: authHeaders }
        );
        const pollData = await pollRes.json();
        finalJob = pollData;
        setProgress(Math.max(25, Math.min(95, Number(pollData.progress) || 50)));
        if (pollData.message) setStatusMessage(pollData.message);
        if (pollData.status === 'done') break;
        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'VideoKit 渲染失败');
        }
      }

      if (finalJob.status !== 'done' || !finalJob.outputUrl) {
        throw new Error('等待渲染结果超时，请检查后端日志。');
      }

      setProgress(96);
      setStatusMessage('正在回传成品 MP4 到当前 Canva 页面...');

      const queuedVideo = await upload({
        type: 'video',
        mimeType: 'video/mp4',
        url: finalJob.outputUrl,
        thumbnailImageUrl: finalJob.thumbnailUrl || finalJob.outputUrl,
        aiDisclosure: edgeVoice ? 'app_generated' : 'none',
      });

      const addFn = [addElementAtPoint, addElementAtCursor].find((fn) => isSupported(fn));
      if (!addFn) {
        throw new Error('当前 Canva 设计类型暂不支持插入视频元素。');
      }

      await addFn({
        type: 'video',
        ref: queuedVideo.ref,
        altText: { text: `VideoKit (${selectedPreset})`, decorative: false },
      });
      await queuedVideo.whenUploaded();

      setProgress(100);
      setStatusMessage('✅ 渲染完成，已自动插入当前 Canva 页面！');
    } catch (err) {
      setErrorMessage((err as Error).message || String(err));
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '12px' }}>
      <Rows spacing="2u">
        <Title size="small">VideoKit 字幕与滚动特效</Title>
        <Text size="small" tone="tertiary">
          基于 Canva 官方 requestExport / upload 闭环流程，可直接为含 Canva 素材的页面烧录高清字幕并插回画布。
        </Text>

        {errorMessage && <Alert tone="critical">{errorMessage}</Alert>}
        {statusMessage && <Alert tone="info">{statusMessage}</Alert>}
        {busy && <ProgressBar value={progress} maxValue={100} ariaLabel="VideoKit 渲染进度" />}

        <FormField
          label="VideoKit 公网 HTTPS 地址"
          value={serverUrl}
          control={(props) => (
            <TextInput
              {...props}
              placeholder="https://videokit.yourdomain.com"
              onChange={(val) => setServerUrl(val)}
            />
          )}
        />

        <FormField
          label="API Token（可选，对应 VIDEOKIT_API_TOKEN）"
          value={apiToken}
          control={(props) => (
            <TextInput
              {...props}
              type="password"
              placeholder="留空表示免密开发模式"
              onChange={(val) => setApiToken(val)}
            />
          )}
        />

        <Button variant="secondary" onClick={loadCatalog} disabled={busy} stretch>
          🔄 连接并同步全部 VideoKit 预设
        </Button>

        <FormField
          label="画面来源"
          value={sourceMode}
          control={(props) => (
            <Select
              {...props}
              options={[
                { value: 'page_export', label: '导出当前 Canva 页面（支持 Canva 官方素材）' },
                { value: 'selected_upload', label: '读取选中的“上传(Uploads)”私有素材（极速）' },
              ]}
              onChange={(v) => setSourceMode(v as SourceMode)}
            />
          )}
        />

        <FormField
          label="字幕效果类型"
          value={presetCategory}
          control={(props) => (
            <Select
              {...props}
              options={[
                { value: 'scroll', label: '滚动字幕 / 祷告画板卡片 (214款 sc-*)' },
                { value: 'subtitle', label: 'T 字幕 / 口播胶囊高亮 (250款 sub-*)' },
              ]}
              onChange={(v) => {
                const cat = v as 'scroll' | 'subtitle';
                setPresetCategory(cat);
                setSelectedPreset(cat === 'scroll' ? 'sc-39' : 'sub-245');
              }}
            />
          )}
        />

        <FormField
          label="选择内置样式预设"
          value={selectedPreset}
          control={(props) => (
            <Select
              {...props}
              options={presetOptions}
              onChange={(v) => setSelectedPreset(v)}
            />
          )}
        />

        <FormField
          label="出字跟随粒度"
          value={revealType}
          control={(props) => (
            <Select {...props} options={REVEAL_OPTIONS} onChange={(v) => setRevealType(v)} />
          )}
        />

        <FormField
          label="写字 / 跟随小图标"
          value={cursorKind}
          control={(props) => (
            <Select {...props} options={cursorOptions} onChange={(v) => setCursorKind(v)} />
          )}
        />

        <FormField
          label="AI 配音（免费 Edge TTS，可选）"
          value={edgeVoice}
          control={(props) => (
            <Select {...props} options={EDGE_VOICES} onChange={(v) => setEdgeVoice(v)} />
          )}
        />

        {presetCategory === 'scroll' && (
          <FormField
            label="滚动标题（可选）"
            value={scrollTitle}
            control={(props) => (
              <TextInput {...props} onChange={(v) => setScrollTitle(v)} />
            )}
          />
        )}

        <FormField
          label="字幕 / 朗读文案"
          value={scriptText}
          control={(props) => (
            <MultilineInput
              {...props}
              maxRows={6}
              onChange={(v) => setScriptText(v)}
            />
          )}
        />

        <Button variant="primary" onClick={handleRenderAndInsert} loading={busy} stretch>
          🎬 调用 VideoKit 渲染并插入当前页
        </Button>
      </Rows>
    </div>
  );
};
