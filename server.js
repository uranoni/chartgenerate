const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { createCanvas } = require('@napi-rs/canvas');
const { Chart, registerables } = require('chart.js');

Chart.register(...registerables);
// Windows 內建繁中字型;Linux/Mac 可改成 'Noto Sans CJK TC' 等
Chart.defaults.font.family = 'Microsoft JhengHei, Noto Sans CJK TC, sans-serif';

const app = express();
const PORT = process.env.PORT || 3000;
const CHART_DIR = path.join(__dirname, 'chart');

app.use(express.json({ limit: '5mb' }));
app.use('/chart', express.static(CHART_DIR)); // 瀏覽器可直接開 /chart/xxx.png

// 白底外掛(否則 PNG 背景是透明的)
const whiteBg = {
  id: 'whiteBg',
  beforeDraw(chart) {
    const c = chart.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-over';
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, chart.width, chart.height);
    c.restore();
  },
};

function renderChart(config, width, height) {
  const canvas = createCanvas(width, height);
  canvas.style = canvas.style || {};
  const cfg = {
    ...config,
    options: {
      ...(config.options || {}),
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
    },
    plugins: [...(config.plugins || []), whiteBg],
  };
  const chart = new Chart(canvas.getContext('2d'), cfg);
  const buffer = canvas.toBuffer('image/png');
  chart.destroy();
  return buffer;
}

function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^\w\-\u4e00-\u9fa5]/g, '_');
  return base || `chart_${Date.now()}`;
}

/**
 * POST /api/chart
 * {
 *   "filename": "sales",
 *   "type": "bar",
 *   "title": "月營收",
 *   "width": 800,
 *   "height": 500,
 *   "labels": ["1月", "2月", "3月"],
 *   "datasets": [{ "label": "營收", "data": [120, 200, 150] }]
 * }
 * 或直接傳完整 Chart.js 設定: { "filename": "x", "config": { type, data, options } }
 */
app.post('/api/chart', async (req, res) => {
  try {
    const {
      filename,
      type = 'bar',
      title,
      labels = [],
      datasets = [],
      options = {},
      config,
      width = 800,
      height = 500,
    } = req.body;

    const chartConfig = config || {
      type,
      data: { labels, datasets },
      options: {
        ...options,
        plugins: {
          ...(options.plugins || {}),
          title: { display: !!title, text: title || '' },
        },
      },
    };

    if (!chartConfig.type || !chartConfig.data) {
      return res.status(400).json({ success: false, message: '缺少 type 或 data' });
    }

    const buffer = renderChart(chartConfig, Number(width), Number(height));

    await fs.mkdir(CHART_DIR, { recursive: true });
    const file = `${safeName(filename)}.png`;
    await fs.writeFile(path.join(CHART_DIR, file), buffer);

    res.json({
      success: true,
      file,
      path: path.join('chart', file),
      url: `${req.protocol}://${req.get('host')}/chart/${file}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`Chart API running: http://localhost:${PORT}`));
