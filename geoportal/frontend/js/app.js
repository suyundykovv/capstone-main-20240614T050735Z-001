(() => {
  const qs = (selector, scope = document) => scope.querySelector(selector);
  const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const config = window.GeoPortalConfig || {};
  const API_BASE = config.apiBase || 'http://localhost:8000';
  const ASSET_BASE = config.assetBase || '..';
  const I18N_BASE = `${ASSET_BASE}/i18n`;

  const state = {
    lang: 'en',
    translations: {},
    files: [],
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
        console.error(error);
        status.textContent = Language.t('contact.status.error');
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
    };
    try {
      state.files = await fetchJSON(`${API_BASE}/api/files`);
      render();
    } catch (error) {
      console.error(error);
      tableBody.innerHTML = `<tr><td colspan="4">${Language.t('dashboard.table.error')}</td></tr>`;
    }
    filterInput?.addEventListener('input', render);
    sortSelect?.addEventListener('change', render);
    tableBody.addEventListener('click', (event) => {
      const target = event.target.closest('[data-file]');
      if (!target) return;
      const filename = target.dataset.file;
      window.open(`${API_BASE}/api/files/${encodeURIComponent(filename)}`, '_blank');
    });
    document.addEventListener('geoportal:language-changed', render);
  };

  const initModelVersions = async () => {
    const placeholders = qsa('[data-model-version]');
    if (!placeholders.length) return;
    try {
      const status = await fetchJSON(`${API_BASE}/api/models/status`);
      placeholders.forEach((node) => {
        const key = node.dataset.modelVersion;
        const info = status[key] || {};
        node.textContent = info.run_id || info.version || Language.t('models.pending');
      });
    } catch (error) {
      console.error(error);
      placeholders.forEach((node) => {
        node.textContent = Language.t('models.pending');
      });
    }
  };

  const initDashboard = async () => {
    const container = qs('[data-dashboard]');
    if (!container) return;
    try {
      state.dashboard = await fetchJSON(`${API_BASE}/api/dashboard/metrics`);
      qs('[data-dashboard-run]')?.textContent = state.dashboard.run_id || '—';
      buildDashboardFilters();
      renderDashboardCharts();
      renderDashboardTable();
      renderFertilizerList();
      document.addEventListener('geoportal:language-changed', () => {
        renderDashboardCharts();
        renderDashboardTable();
        renderFertilizerList();
      });
    } catch (error) {
      console.error(error);
    }
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
    if (rmseCtx) {
      if (state.charts.bar) state.charts.bar.destroy();
      const labelsBar = state.dashboard.rmse_mae.map((item) => item.label);
      state.charts.bar = new Chart(rmseCtx, {
        type: 'bar',
        data: {
          labels: labelsBar,
          datasets: [
            {
              label: 'RMSE',
              data: state.dashboard.rmse_mae.map((item) => item.rmse),
              backgroundColor: '#003366',
            },
            {
              label: 'MAE',
              data: state.dashboard.rmse_mae.map((item) => item.mae),
              backgroundColor: '#00a3a3',
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
    const pieCtx = qs('#dashboard-pie');
    if (pieCtx) {
      if (state.charts.pie) state.charts.pie.destroy();
      const distribution = state.dashboard.disease_distribution || [];
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
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      setStatus('predicting');
      try {
        const result = await fetchJSON(`${API_BASE}/api/predict?lang=${state.lang}`, {
          method: 'POST',
          body: formData,
        });
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
      try {
        const result = await fetchJSON(`${API_BASE}/api/predict?lang=${state.lang}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        renderYieldResult(result);
        output.dataset.state = 'ready';
      } catch (error) {
        console.error(error);
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
    try {
      state.history = await fetchJSON(`${API_BASE}/api/yield/history?${params.toString()}`);
      renderHistoryTable();
      renderHistoryChart();
    } catch (error) {
      console.error(error);
    }
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
      initCalculator();
      initDashboard();
      initLeafletInsights();
    })();
  });

  window.GeoPortalState = state;
})();
