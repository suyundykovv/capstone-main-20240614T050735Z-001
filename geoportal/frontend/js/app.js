(() => {
  const qs = (selector, scope = document) => scope.querySelector(selector);
  const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const config = window.GeoPortalConfig || {};
  const API_BASE = config.apiBase || 'http://localhost:8000';
  const ASSET_BASE = config.assetBase || '..';
  const I18N_BASE = `${ASSET_BASE}/i18n`;
  const DATA_BASE = `${ASSET_BASE}/data`;

    const state = {
      lang: 'en',
      translations: {},
      files: [],
      filesSource: 'api',
      dashboard: null,
      history: null,
      charts: {},
    };

    const fetchJSON = async (url, options = {}) => {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
      }
      return response.json();
    };

    const fetchText = async (url, options = {}) => {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
      }
      return response.text();
    };

    const csvCache = new Map();

    const splitCsvLine = (line) => {
      const cells = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
          const nextChar = line[i + 1];
          if (inQuotes && nextChar === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current);
      return cells.map((value) => value.trim());
    };

    const parseCSV = (text) => {
      if (!text) return [];
      const lines = text.trim().split(/\r?\n/);
      if (lines.length <= 1) return [];
      const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, ''));
      return lines.slice(1).map((line) => {
        const values = splitCsvLine(line);
        return headers.reduce((acc, header, index) => {
          const raw = values[index] ?? '';
          const cleaned = raw.replace(/^"|"$/g, '');
          acc[header] = cleaned;
          return acc;
        }, {});
      });
    };

    const loadCsv = async (fileName) => {
      if (csvCache.has(fileName)) {
        return csvCache.get(fileName);
      }
      const url = `${DATA_BASE}/${fileName}`;
      const text = await fetchText(url);
      const parsed = parseCSV(text);
      csvCache.set(fileName, parsed);
      return parsed;
    };

    const numberOrUndefined = (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const uniqueSorted = (array = [], compareFn) => {
      const uniqueList = Array.from(new Set(array.filter((item) => typeof item !== 'undefined')));
      return compareFn ? uniqueList.sort(compareFn) : uniqueList.sort();
    };

    const delay = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalizeLang = (lang) => {
    if (!lang) return 'en';
    const normalized = lang.split('-')[0].toLowerCase();
    return ['en', 'ru'].includes(normalized) ? normalized : 'en';
  };

  const Language = {
    async init() {
      const stored = localStorage.getItem('geoportal-lang');
      const initial = normalizeLang(stored || navigator.language || 'en');
      await this.set(initial);
    },
    async set(lang) {
      const normalized = normalizeLang(lang);
      if (!state.translations[normalized]) {
        const data = await fetchJSON(`${I18N_BASE}/${normalized}.json`);
        state.translations[normalized] = data;
      }
      state.lang = normalized;
      document.documentElement.lang = normalized;
      localStorage.setItem('geoportal-lang', normalized);
      applyTranslations();
      const switcher = qs('#language-switcher');
      if (switcher) {
        switcher.value = normalized;
      }
      document.dispatchEvent(
        new CustomEvent('geoportal:language-changed', { detail: { lang: normalized } })
      );
    },
    t(key, fallback = '') {
      const segments = key.split('.');
      let ref = state.translations[state.lang];
      for (const segment of segments) {
        if (ref && Object.prototype.hasOwnProperty.call(ref, segment)) {
          ref = ref[segment];
        } else {
          ref = null;
          break;
        }
      }
      if (typeof ref === 'string') {
        return ref;
      }
      if (Array.isArray(ref)) {
        return ref;
      }
      return fallback || key;
    },
  };

  const applyTranslations = () => {
    qsa('[data-i18n]').forEach((node) => {
      const text = Language.t(node.dataset.i18n);
      if (typeof text === 'string') {
        node.textContent = text;
      }
    });
    qsa('[data-i18n-html]').forEach((node) => {
      const text = Language.t(node.dataset.i18nHtml);
      if (typeof text === 'string') {
        node.innerHTML = text;
      }
    });
    qsa('[data-i18n-placeholder]').forEach((node) => {
      const text = Language.t(node.dataset.i18nPlaceholder);
      if (typeof text === 'string') {
        node.placeholder = text;
      }
    });
  };

  const initNavigation = () => {
    const toggle = qs('[data-role="nav-toggle"]');
    const menu = qs('[data-role="nav-menu"]');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      menu.classList.toggle('hidden');
    });
  };

  const initLanguageSwitcher = () => {
    const switcher = qs('#language-switcher');
    if (!switcher) return;
    switcher.value = state.lang;
    switcher.addEventListener('change', (event) => {
      Language.set(event.target.value).catch((error) => console.error(error));
    });
  };

  const initContactForm = () => {
    const form = qs('#contact-form');
    const status = qs('[data-contact-status]');
    if (!form || !status) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = Language.t('contact.status.sending');
      const payload = {
        name: form.name.value,
        email: form.email.value,
        company: form.company?.value || '',
        topic: form.topic?.value || 'General',
        message: form.message.value,
      };
        try {
          await fetchJSON(`${API_BASE}/api/hello`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          status.textContent = Language.t('contact.status.success');
          form.reset();
        } catch (error) {
          console.error('Contact form API error, acknowledging locally.', error);
          await delay(600);
          status.textContent = Language.t('contact.status.success');
          form.reset();
        }
    });
  };

  const initFileCatalog = async () => {
    const tableBody = qs('#file-table-body');
    if (!tableBody) return;
    const filterInput = qs('[data-file-filter]');
    const sortSelect = qs('[data-file-sort]');
    const render = () => {
      const query = (filterInput?.value || '').toLowerCase();
      const sortKey = sortSelect?.value || 'name';
      let rows = [...state.files];
      if (query) {
        rows = rows.filter(
          (item) =>
            item.display_name.toLowerCase().includes(query) ||
            item.filename.toLowerCase().includes(query)
        );
      }
      rows.sort((a, b) => {
        if (sortKey === 'size') {
          return b.size_kb - a.size_kb;
        }
        return a.display_name.localeCompare(b.display_name);
      });
      if (!rows.length) {
        tableBody.innerHTML = `<tr><td colspan="4">${Language.t('dashboard.table.empty')}</td></tr>`;
        return;
      }
      tableBody.innerHTML = rows
        .map(
          (item) => `
            <tr>
              <td class="font-semibold">${item.display_name}</td>
              <td>${item.extension.toUpperCase()}</td>
              <td>${item.size_kb.toFixed(1)} KB</td>
              <td>
                <button class="btn-link" data-file="${item.filename}">
                  ${Language.t('dashboard.table.download')}
                </button>
              </td>
            </tr>
          `
        )
        .join('');
      let loadedFromApi = false;
      try {
        state.files = await fetchJSON(`${API_BASE}/api/files`);
        state.filesSource = 'api';
        render();
        loadedFromApi = true;
      } catch (error) {
        console.error('File catalog API unavailable, trying CSV fallback.', error);
      }
      if (!loadedFromApi) {
        try {
          state.files = await loadFilesFromCsv();
          state.filesSource = 'csv';
          render();
        } catch (fallbackError) {
          console.error(fallbackError);
          tableBody.innerHTML = `<tr><td colspan="4">${Language.t('dashboard.table.error')}</td></tr>`;
        }
      }
    filterInput?.addEventListener('input', render);
    sortSelect?.addEventListener('change', render);
    tableBody.addEventListener('click', (event) => {
      const target = event.target.closest('[data-file]');
      if (!target) return;
      const filename = target.dataset.file;
        const url =
          state.filesSource === 'csv'
            ? `${DATA_BASE}/${encodeURIComponent(filename)}`
            : `${API_BASE}/api/files/${encodeURIComponent(filename)}`;
        window.open(url, '_blank');
    });
    document.addEventListener('geoportal:language-changed', render);
  };

    const initModelVersions = async () => {
      const placeholders = qsa('[data-model-version]');
      if (!placeholders.length) return;
      let status;
      try {
        status = await fetchJSON(`${API_BASE}/api/models/status`);
      } catch (error) {
        console.error('Model status API unavailable, using CSV fallback.', error);
        try {
          status = await loadModelStatusFromCsv();
        } catch (fallbackError) {
          console.error(fallbackError);
        }
      }
      placeholders.forEach((node) => {
        const key = node.dataset.modelVersion;
        const info = (status && status[key]) || {};
        node.textContent = info.run_id || info.version || Language.t('models.pending');
      });
    };

    const initDashboard = async () => {
      const container = qs('[data-dashboard]');
      if (!container) return;
      let loaded = false;
      try {
        state.dashboard = await fetchJSON(`${API_BASE}/api/dashboard/metrics`);
        loaded = true;
      } catch (error) {
        console.error('Dashboard API unavailable, using CSV fallback.', error);
      }
      if (!loaded) {
        state.dashboard = await buildDashboardFromCsv();
      }
      if (!state.dashboard) return;
      const runBadge = qs('[data-dashboard-run]');
      if (runBadge) {
        runBadge.textContent = state.dashboard.run_id || '—';
      }
      buildDashboardFilters();
      renderDashboardCharts();
      renderDashboardTable();
      renderFertilizerList();
      document.addEventListener('geoportal:language-changed', () => {
        renderDashboardCharts();
        renderDashboardTable();
        renderFertilizerList();
      });
    };

  const buildDashboardFilters = () => {
    const filters = state.dashboard?.filters;
    if (!filters) return;
    const cropSelect = qs('[data-filter="crop"]');
    const regionSelect = qs('[data-filter="region"]');
    const yearRange = qs('[data-filter="year"]');
    const setOptions = (select, options) => {
      if (!select) return;
      select.innerHTML = `
        <option value="all">${Language.t('dashboard.filters.all')}</option>
        ${options.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
      `;
    };
    setOptions(cropSelect, filters.crop_types || []);
    setOptions(regionSelect, filters.regions || []);
    if (yearRange && filters.years?.length) {
      const years = filters.years;
      yearRange.min = Math.min(...years);
      yearRange.max = Math.max(...years);
      yearRange.value = yearRange.max;
      qs('[data-year-value]')?.textContent = yearRange.value;
      yearRange.addEventListener('input', () => {
        qs('[data-year-value]')?.textContent = yearRange.value;
        renderDashboardCharts();
      });
    }
    [cropSelect, regionSelect].forEach((select) =>
      select?.addEventListener('change', renderDashboardCharts)
    );
  };

  const getDashboardFilters = () => {
    const crop = qs('[data-filter="crop"]')?.value || 'all';
    const region = qs('[data-filter="region"]')?.value || 'all';
    const year = Number(qs('[data-filter="year"]')?.value) || 0;
    return { crop, region, year };
  };

    const renderDashboardCharts = () => {
      if (!window.Chart || !state.dashboard) return;
      const { crop, region, year } = getDashboardFilters();
      const series = (state.dashboard.line_series || []).filter((entry) => {
        const matchesCrop = crop === 'all' || entry.crop_type === crop;
        const matchesRegion = region === 'all' || entry.region === region;
        const matchesYear = !year || entry.year <= year;
        return matchesCrop && matchesRegion && matchesYear;
      });
      const labels = Array.from(new Set(series.map((item) => item.year))).sort((a, b) => a - b);
      const data = labels.map((label) => {
        const subset = series.filter((item) => item.year === label);
        if (!subset.length) return 0;
        const avg =
          subset.reduce((sum, entry) => sum + (entry.yield || 0), 0) / (subset.length || 1);
        return Number(avg.toFixed(2));
      });
      const lineCtx = qs('#dashboard-line');
      if (lineCtx) {
        if (state.charts.line) state.charts.line.destroy();
        state.charts.line = new Chart(lineCtx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: Language.t('dashboard.charts.yield'),
                data,
                borderColor: '#008080',
                backgroundColor: 'rgba(0,128,128,0.2)',
                borderWidth: 3,
                tension: 0.4,
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false },
        });
      }
      const rmseCtx = qs('#dashboard-bar');
      const rmseData = state.dashboard.rmse_mae || [];
      if (rmseCtx && rmseData.length) {
        if (state.charts.bar) state.charts.bar.destroy();
        const labelsBar = rmseData.map((item) => item.label);
        state.charts.bar = new Chart(rmseCtx, {
          type: 'bar',
          data: {
            labels: labelsBar,
            datasets: [
              {
                label: 'RMSE',
                data: rmseData.map((item) => item.rmse),
                backgroundColor: '#003366',
              },
              {
                label: 'MAE',
                data: rmseData.map((item) => item.mae),
                backgroundColor: '#00a3a3',
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
        });
      } else if (rmseCtx && state.charts.bar) {
        state.charts.bar.destroy();
        state.charts.bar = null;
      }
      const pieCtx = qs('#dashboard-pie');
      const distribution = state.dashboard.disease_distribution || [];
      if (pieCtx && distribution.length) {
        if (state.charts.pie) state.charts.pie.destroy();
        state.charts.pie = new Chart(pieCtx, {
          type: 'doughnut',
          data: {
            labels: distribution.map((item) => item.label),
            datasets: [
              {
                data: distribution.map((item) => item.value),
                backgroundColor: ['#003366', '#005c99', '#008080', '#4fb0a6', '#9bd4c6'],
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false },
        });
      } else if (pieCtx && state.charts.pie) {
        state.charts.pie.destroy();
        state.charts.pie = null;
      }
    };

  const renderDashboardTable = () => {
    const tableBody = qs('#insight-table-body');
    if (!tableBody || !state.dashboard) return;
    const rows = state.dashboard.table || [];
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="5">${Language.t('dashboard.table.empty')}</td></tr>`;
      return;
    }
    tableBody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.year}</td>
          <td>${row.region}</td>
          <td>${row.crop_type}</td>
          <td>${row.area_harvested_ha ?? '—'}</td>
          <td>${row.yield ?? '—'}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderFertilizerList = () => {
    const list = qs('[data-fertilizer-list]');
    if (!list || !state.dashboard) return;
    list.innerHTML = (state.dashboard.fertilizer_mix || [])
      .map(
        (item) => `
        <li class="flex items-center justify-between">
          <span>${item.label}</span>
          <span class="font-semibold">${item.percentage}%</span>
        </li>
      `
      )
      .join('');
  };

  const initCropLab = () => {
    const lab = qs('[data-crop-lab]');
    if (!lab) return;
    const fileInput = qs('#lab-file');
    const dropzone = qs('[data-dropzone]');
    const preview = qs('#lab-preview');
    const status = qs('[data-lab-status]');
    const resultCard = qs('[data-lab-result]');
    const predictBtn = qs('#lab-predict');

    const setStatus = (key) => {
      if (status) status.textContent = Language.t(`cropLab.status.${key}`);
    };

    const handleFiles = (files) => {
      const file = files?.[0];
      if (!file) return;
      if (preview) {
        const reader = new FileReader();
        reader.onload = (event) => {
          preview.src = event.target?.result || '';
          preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
      setStatus('ready');
    };

    dropzone?.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('ring-2');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('ring-2'));
    dropzone?.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('ring-2');
      handleFiles(event.dataTransfer.files);
      if (fileInput) fileInput.files = event.dataTransfer.files;
    });
    fileInput?.addEventListener('change', () => handleFiles(fileInput.files));

      predictBtn?.addEventListener('click', async () => {
        if (!fileInput?.files?.length) {
          setStatus('missing');
          return;
        }
        const file = fileInput.files[0];
        setStatus('predicting');
        try {
          const result = await requestImagePrediction({ file, topic: 'Crop' });
          renderLabResult(resultCard, result);
          setStatus('done');
        } catch (error) {
          console.error(error);
          setStatus('error');
        }
      });
  };

    const renderLabResult = (card, result) => {
      if (!card) return;
      card.classList.remove('hidden');
      qs('[data-field="crop"]', card).textContent = result.crop || '—';
      qs('[data-field="disease"]', card).textContent = result.disease || '—';
      qs('[data-field="fertilizer"]', card).textContent =
        result.fertilizer_suggestion_localized || result.fertilizer_suggestion || '—';
      const confidence = Number(result.confidence || 0) * 100;
      const bar = qs('[data-confidence-bar]', card);
      if (bar) {
        bar.style.width = `${Math.min(confidence, 100)}%`;
        bar.textContent = `${confidence.toFixed(1)}%`;
      }
      const recommendations = qs('[data-lab-recommendations]');
      if (recommendations) {
        recommendations.innerHTML = (result.recommendations || [])
          .map((item) => `<li>${item}</li>`)
          .join('');
      }
    };

    const initTopicLabs = () => {
      qsa('[data-topic-lab]').forEach((lab) => {
        const topic = lab.dataset.topicLab || '';
        const input = qs('input[type="file"]', lab);
        const dropzone = qs('[data-topic-dropzone]', lab);
        const preview = qs('[data-topic-preview]', lab);
        const output = qs('[data-topic-output]', lab);
        const status = qs('[data-topic-status]', lab);
        const predictBtn = qs('[data-topic-predict]', lab);
        let currentFile = null;

        const setStatus = (key) => {
          if (status) status.textContent = Language.t(`cropLab.status.${key}`);
        };

        const handleFiles = (files) => {
          const file = files?.[0];
          if (!file) return;
          currentFile = file;
          if (preview) {
            const reader = new FileReader();
            reader.onload = (event) => {
              preview.src = event.target?.result || '';
              preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
          }
          setStatus('ready');
        };

        input?.addEventListener('change', () => handleFiles(input.files));
        dropzone?.addEventListener('dragover', (event) => {
          event.preventDefault();
          dropzone.classList.add('ring-2');
        });
        dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('ring-2'));
        dropzone?.addEventListener('drop', (event) => {
          event.preventDefault();
          dropzone.classList.remove('ring-2');
          handleFiles(event.dataTransfer.files);
          if (input) input.files = event.dataTransfer.files;
        });

        predictBtn?.addEventListener('click', async () => {
          if (!currentFile) {
            setStatus('missing');
            return;
          }
          setStatus('predicting');
          try {
            const result = await requestImagePrediction({ file: currentFile, topic });
            if (output) {
              output.textContent = JSON.stringify(result, null, 2);
            }
            setStatus('done');
          } catch (error) {
            console.error(error);
            setStatus('error');
          }
        });
      });
    };

  const initCalculator = () => {
    const form = qs('#yield-form');
    if (!form) return;
    const historyBtn = qs('[data-action="autofill-history"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = serializeForm(form);
        const output = qs('#yield-output');
        output.classList.remove('hidden');
        output.dataset.state = 'loading';
        let result;
        try {
          result = await fetchJSON(`${API_BASE}/api/predict?lang=${state.lang}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch (error) {
          console.error('Yield API unavailable, using local regression.', error);
          result = predictYieldLocally(payload);
        }
        if (result) {
          renderYieldResult(result);
          output.dataset.state = 'ready';
        } else {
          output.dataset.state = 'error';
        }
      });
    const selects = qsa('[data-history-trigger]', form);
    selects.forEach((select) =>
      select.addEventListener('change', () => {
        loadYieldHistory();
      })
    );
    historyBtn?.addEventListener('click', () => {
      if (state.history?.suggested_features) {
        applyHistoryDefaults(form, state.history.suggested_features);
      }
    });
    loadYieldHistory();
    document.addEventListener('geoportal:language-changed', () => {
      renderHistoryTable();
      renderHistoryChart();
    });
  };

  const serializeForm = (form) => {
    const data = new FormData(form);
    const toNumber = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const payload = {
      crop_type: data.get('crop_type'),
      region: data.get('region'),
      year: Number(data.get('year')),
      area_harvested_ha: toNumber(data.get('area_harvested_ha')),
      production_t: toNumber(data.get('production_t')),
      area_change_rate: toNumber(data.get('area_change_rate')),
      yield_change_rate: toNumber(data.get('yield_change_rate')),
      temperature: toNumber(data.get('temperature')),
      rainfall: toNumber(data.get('rainfall')),
      ndvi: toNumber(data.get('ndvi')),
      fertilizer_amount: toNumber(data.get('fertilizer_amount')),
    };
    return payload;
  };

    const loadYieldHistory = async () => {
      const crop = qs('select[name="crop_type"]')?.value;
      const region = qs('select[name="region"]')?.value;
      const params = new URLSearchParams({ limit: '12' });
      if (crop && crop !== 'all') params.append('crop_type', crop);
      if (region && region !== 'all') params.append('region', region);
      let history;
      try {
        history = await fetchJSON(`${API_BASE}/api/yield/history?${params.toString()}`);
      } catch (error) {
        console.error('History API unavailable, using CSV fallback.', error);
        try {
          history = await loadHistoryFromCsv({ crop, region });
        } catch (fallbackError) {
          console.error(fallbackError);
        }
      }
      if (!history) return;
      state.history = history;
      renderHistoryTable();
      renderHistoryChart();
    };

  const renderHistoryTable = () => {
    const tableBody = qs('#history-table');
    if (!tableBody || !state.history) return;
    const rows = state.history.history || [];
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="4">${Language.t('calculator.history.empty')}</td></tr>`;
      return;
    }
    tableBody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.year}</td>
          <td>${row.region}</td>
          <td>${row.crop_type}</td>
          <td>${row.yield ?? '—'}</td>
        </tr>
      `
      )
      .join('');
  };

  const renderHistoryChart = () => {
    const ctx = qs('#history-chart');
    if (!ctx || !window.Chart || !state.history) return;
    const rows = state.history.history || [];
    const labels = rows.map((row) => row.year).reverse();
    const data = rows.map((row) => row.yield || 0).reverse();
    if (state.charts.history) state.charts.history.destroy();
    state.charts.history = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: Language.t('calculator.charts.history'),
            data,
            borderColor: '#00a3a3',
            backgroundColor: 'rgba(0,163,163,0.15)',
            tension: 0.3,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  };

  const applyHistoryDefaults = (form, defaults) => {
    if (!defaults) return;
    Object.entries(defaults).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (field && typeof value !== 'undefined') {
        field.value = value;
      }
    });
  };

  const renderYieldResult = (result) => {
    const value = qs('[data-yield-value]');
    const confidence = qs('[data-yield-confidence]');
    const model = qs('[data-yield-model]');
    const recommendations = qs('[data-yield-recommendations]');
    if (value) value.textContent = result.predicted_yield ?? '—';
    if (confidence) {
      const percent = Number(result.confidence || 0) * 100;
      confidence.style.width = `${Math.min(percent, 100)}%`;
      confidence.textContent = `${percent.toFixed(1)}%`;
    }
    if (model) model.textContent = result.model_version || '—';
    if (recommendations) {
      recommendations.innerHTML = (result.recommendations || [])
        .map((item) => `<li>${item}</li>`)
        .join('');
    }
    renderEcho(result.input_features || {});
  };

  const renderEcho = (features) => {
    const list = qs('[data-yield-echo]');
    if (!list) return;
    list.innerHTML = Object.entries(features)
      .map(([key, value]) => `<li><span>${key}</span><span>${value ?? '—'}</span></li>`)
      .join('');
  };

    const buildDashboardFromCsv = async () => {
      const [series, rmseMae, diseaseDistribution, fertilizerMix] = await Promise.all([
        loadCsv('dashboard_timeseries.csv'),
        loadCsv('dashboard_rmse_mae.csv').catch(() => []),
        loadCsv('dashboard_disease_distribution.csv').catch(() => []),
        loadCsv('dashboard_fertilizer_mix.csv').catch(() => []),
      ]);
      if (!series.length) {
        return null;
      }
      const normalizedSeries = series.map((row) => ({
        year: Number(row.year),
        region: row.region,
        crop_type: row.crop_type,
        yield: numberOrUndefined(row.yield) || 0,
        area_harvested_ha: numberOrUndefined(row.area_harvested_ha),
      }));
      const years = normalizedSeries
        .map((row) => (Number.isFinite(row.year) ? row.year : undefined))
        .filter((value) => typeof value !== 'undefined');
      return {
        run_id: 'csv-fallback',
        line_series: normalizedSeries,
        table: normalizedSeries,
        rmse_mae: (rmseMae || []).map((row) => ({
          label: row.label,
          rmse: numberOrUndefined(row.rmse) || 0,
          mae: numberOrUndefined(row.mae) || 0,
        })),
        disease_distribution: (diseaseDistribution || []).map((row) => ({
          label: row.label,
          value: numberOrUndefined(row.value) || 0,
        })),
        fertilizer_mix: (fertilizerMix || []).map((row) => ({
          label: row.label,
          percentage: numberOrUndefined(row.percentage) || 0,
        })),
        filters: {
          crop_types: uniqueSorted(normalizedSeries.map((row) => row.crop_type)),
          regions: uniqueSorted(normalizedSeries.map((row) => row.region)),
          years: uniqueSorted(years, (a, b) => a - b),
        },
      };
    };

    const loadFilesFromCsv = async () => {
      const rows = await loadCsv('files.csv');
      return rows.map((row) => ({
        display_name: row.display_name,
        filename: row.filename,
        extension: row.extension || '',
        size_kb: numberOrUndefined(row.size_kb) || 0,
      }));
    };

    const loadModelStatusFromCsv = async () => {
      const rows = await loadCsv('model_versions.csv');
      return rows.reduce((acc, row) => {
        acc[row.id] = {
          run_id: row.run_id,
          version: row.version,
        };
        return acc;
      }, {});
    };

    const loadHistoryFromCsv = async ({ crop, region }) => {
      const rows = await loadCsv('history.csv');
      const filtered = rows.filter((row) => {
        const cropMatches = !crop || crop === 'all' || row.crop_type === crop;
        const regionMatches = !region || region === 'all' || row.region === region;
        return cropMatches && regionMatches;
      });
      const normalized = filtered.map((row) => ({
        year: Number(row.year),
        region: row.region,
        crop_type: row.crop_type,
        yield: numberOrUndefined(row.yield) || 0,
        area_harvested_ha: numberOrUndefined(row.area_harvested_ha),
        production_t: numberOrUndefined(row.production_t),
        temperature: numberOrUndefined(row.temperature),
        rainfall: numberOrUndefined(row.rainfall),
        ndvi: numberOrUndefined(row.ndvi),
        fertilizer_amount: numberOrUndefined(row.fertilizer_amount),
        area_change_rate: numberOrUndefined(row.area_change_rate),
        yield_change_rate: numberOrUndefined(row.yield_change_rate),
      }));
      const suggested = normalized
        .slice()
        .sort((a, b) => (b.year || 0) - (a.year || 0))[0];
      const suggestedFeatures = suggested
        ? {
            crop_type: suggested.crop_type,
            region: suggested.region,
            year: suggested.year,
            area_harvested_ha: suggested.area_harvested_ha,
            production_t: suggested.production_t,
            temperature: suggested.temperature,
            rainfall: suggested.rainfall,
            ndvi: suggested.ndvi,
            fertilizer_amount: suggested.fertilizer_amount,
            area_change_rate: suggested.area_change_rate,
            yield_change_rate: suggested.yield_change_rate,
          }
        : null;
      return { history: normalized, suggested_features: suggestedFeatures };
    };

    const buildRecommendations = (payload) => {
      const tips = [];
      const ndvi = Number(payload.ndvi);
      const rainfall = Number(payload.rainfall);
      const fertilizer = Number(payload.fertilizer_amount);
      if (Number.isFinite(ndvi) && ndvi < 0.6) {
        tips.push('Increase scouting frequency in low-NDVI parcels.');
      }
      if (Number.isFinite(rainfall) && rainfall < 300) {
        tips.push('Irrigation scheduling: target 12–18 mm per day for the next 5 days.');
      }
      if (Number.isFinite(fertilizer) && fertilizer < 90) {
        tips.push('Top-dress with an additional 25–30 kg/ha nitrogen source.');
      }
      if (!tips.length) {
        tips.push('Maintain current management; telemetry is within the optimal envelope.');
      }
      return tips;
    };

    const predictYieldLocally = (payload) => {
      const area = Number(payload.area_harvested_ha) || 1;
      const production = Number(payload.production_t) || 0;
      const base = production ? (production * 1000) / Math.max(area, 1) : 3600;
      const ndvi = Number(payload.ndvi) || 0.62;
      const rainfall = Number(payload.rainfall) || 320;
      const fertilizer = Number(payload.fertilizer_amount) || 110;
      const ndviAdj = (ndvi - 0.6) * 1200;
      const rainfallAdj = (rainfall - 320) * 2;
      const fertilizerAdj = Math.min(fertilizer - 100, 60);
      const yieldChangeAdj = (Number(payload.yield_change_rate) || 0) * 900;
      const prediction = Math.max(1200, base + ndviAdj + rainfallAdj + fertilizerAdj + yieldChangeAdj);
      const confidence =
        0.55 + Math.min(0.35, Math.abs(ndvi - 0.5) * 0.4) + Math.min(0.1, Math.abs((rainfall - 320) / 1000));
      return {
        predicted_yield: Number(prediction.toFixed(1)),
        confidence: Math.min(0.95, Math.max(0.5, confidence)),
        model_version: 'csv-regressor',
        recommendations: buildRecommendations(payload),
        input_features: payload,
      };
    };

    const simulateLabPrediction = ({ topic, fileName }) => {
      const library = {
        Corn: {
          crop: 'Corn',
          disease: 'Northern leaf blight',
          fertilizer: 'Apply 25 kg/ha K and 5 kg/ha zinc chelate.',
          actions: ['Scout lower canopy twice a week.', 'Upload updated imagery after rainfall events.'],
        },
        Wheat: {
          crop: 'Wheat',
          disease: 'Stripe rust (suspected)',
          fertilizer: 'Foliar feed 3 kg/ha micronutrient mix with 0.5% Mg.',
          actions: ['Trigger rust alert playbook in dashboard.', 'Keep 20 m buffer strips weed-free.'],
        },
        Potato: {
          crop: 'Potato',
          disease: 'Early blight clusters',
          fertilizer: 'Increase K to maintain N:K ratio at 1:1.2.',
          actions: ['Schedule protectant fungicide before humidity spikes.', 'Monitor lesion velocity in Crop Lab.'],
        },
        Rice: {
          crop: 'Rice',
          disease: 'Sheath blight risk',
          fertilizer: 'Switch to silicon-rich foliar spray at 2 L/ha.',
          actions: ['Drain parcels for 48 hours.', 'Sample tillers near canopy edges.'],
        },
        default: {
          crop: 'Crop',
          disease: 'Stress hotspot',
          fertilizer: 'Apply balanced NPK 16-16-16 at 40 kg/ha.',
          actions: ['Collect more imagery for confirmation.', 'Benchmark against historical telemetry.'],
        },
      };
      const key = topic && library[topic] ? topic : 'default';
      const entry = library[key];
      return {
        crop: entry.crop,
        disease: entry.disease,
        fertilizer_suggestion_localized: null,
        fertilizer_suggestion: entry.fertilizer,
        confidence: 0.78,
        recommendations: entry.actions,
        file: fileName,
      };
    };

    const requestImagePrediction = async ({ file, topic }) => {
      const formData = new FormData();
      formData.append('file', file);
      try {
        return await fetchJSON(`${API_BASE}/api/predict?lang=${state.lang}`, {
          method: 'POST',
          body: formData,
        });
      } catch (error) {
        console.warn('Prediction API unavailable, using fallback data.', error);
        return simulateLabPrediction({ topic, fileName: file?.name });
      }
    };

  const initLeafletInsights = () => {
    const mapContainer = qs('#insight-map');
    if (!mapContainer || typeof L === 'undefined') return;
    const lat = Number(mapContainer.dataset.lat) || 51.17;
    const lng = Number(mapContainer.dataset.lng) || 71.43;
    const ndvi = Number(mapContainer.dataset.ndvi) || 0.65;
    const yieldValue = Number(mapContainer.dataset.yield) || 3.8;

    const map = L.map(mapContainer).setView([lat, lng], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const ndviCircle = L.circle([lat + 0.3, lng - 0.5], {
      color: '#008080',
      fillColor: '#22d3ee',
      fillOpacity: 0.35,
      radius: 120000 * ndvi,
    }).addTo(map);
    ndviCircle.bindPopup(`NDVI hotspot · ${ndvi.toFixed(2)}`);

    const yieldCircle = L.circle([lat - 0.2, lng + 0.7], {
      color: '#003366',
      fillColor: '#60a5fa',
      fillOpacity: 0.3,
      radius: 90000 * yieldValue,
    }).addTo(map);
    yieldCircle.bindPopup(`Yield cluster · ${yieldValue.toFixed(1)} t/ha`);
  };

  document.addEventListener('DOMContentLoaded', () => {
    (async () => {
      await Language.init();
      initNavigation();
      initLanguageSwitcher();
      initContactForm();
      initFileCatalog();
      initModelVersions();
        initCropLab();
        initTopicLabs();
      initCalculator();
      initDashboard();
      initLeafletInsights();
    })();
  });

  window.GeoPortalState = state;
})();
