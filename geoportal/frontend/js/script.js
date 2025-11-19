const API_BASE = 'http://localhost:8000';

const qs = (selector, scope = document) => scope.querySelector(selector);

function initNavigation() {
  const toggle = qs('.nav-toggle');
  const navList = qs('.navbar ul');
  if (!toggle || !navList) return;
  toggle.addEventListener('click', () => {
    navList.classList.toggle('open');
  });
}

function initContactForm() {
  const form = qs('#contact-form');
  const statusBox = qs('#contact-status');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusBox.textContent = 'Sending…';
    try {
      const resp = await fetch(`${API_BASE}/api/hello`);
      if (!resp.ok) throw new Error('Network error');
      statusBox.textContent = 'Thanks! Our agronomists will reach out shortly.';
      form.reset();
    } catch (error) {
      console.error(error);
      statusBox.textContent = 'Something went wrong. Try again later.';
    }
  });
}

function initFileCatalog() {
  const tableBody = qs('#file-table-body');
  const quickButton = qs('#quick-download');
  if (!tableBody) return;
  fetch(`${API_BASE}/api/files`)
    .then((response) => response.json())
    .then((files) => {
      window.geoportalFiles = files;
      tableBody.innerHTML = '';
      files.forEach((file) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="font-semibold">${file.display_name}</td>
          <td>${(file.size_kb).toFixed(1)} KB</td>
          <td>${new Date(file.modified_at).toLocaleString()}</td>
          <td><button class="primary" data-filename="${file.filename}">Download</button></td>
        `;
        tableBody.appendChild(tr);
      });
      tableBody.addEventListener('click', (event) => {
        if (event.target.matches('button[data-filename]')) {
          const filename = event.target.getAttribute('data-filename');
          window.open(`${API_BASE}/api/files/${encodeURIComponent(filename)}`, '_blank');
        }
      });
      if (quickButton && files.length > 0) {
        quickButton.disabled = false;
        quickButton.addEventListener('click', () => {
          const filename = files[0].filename;
          window.open(`${API_BASE}/api/files/${encodeURIComponent(filename)}`, '_blank');
        });
      }
    })
    .catch((error) => {
      console.error('Failed to load files', error);
      tableBody.innerHTML = '<tr><td colspan="4">Unable to load files.</td></tr>';
    });
}

function initDashboardCharts() {
  const ctx = qs('#yieldChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [
        {
          label: 'Yield Forecast (t/ha)',
          data: [4.2, 4.8, 5.1, 5.6, 6.0, 6.4, 6.8, 6.5, 6.1, 5.7, 5.0, 4.5],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.15)',
          tension: 0.4,
          borderWidth: 3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
  return chart;
}

function initMap() {
  const mapContainer = qs('#geoMap');
  if (!mapContainer || typeof L === 'undefined') return;
  const map = L.map('geoMap').setView([53.2, 63.6], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const polygon = L.polygon(
    [
      [54.8, 69.2],
      [54.3, 66.5],
      [53.4, 64.9],
      [52.8, 66.4],
      [53.1, 69.8],
    ],
    {
      color: '#16a34a',
      fillColor: '#86efac',
      fillOpacity: 0.4,
    }
  ).addTo(map);
  polygon.bindPopup('North Kazakhstan Productive Zone');
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initContactForm();
  initFileCatalog();
  initDashboardCharts();
  initMap();
});
