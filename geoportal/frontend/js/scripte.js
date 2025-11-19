const LAB_API_BASE = 'http://localhost:8000';

class CropLab {
  constructor(root) {
    this.root = root;
    this.fileInput = root.querySelector('input[type="file"]');
    this.previewImage = root.querySelector('#selectedImage');
    this.resultBlock = root.querySelector('#prediction-output');
    this.uploadButton = root.querySelector('#uploadBtn');
    this.predictButton = root.querySelector('#predictBtn');
    this.lastUploadedFilename = null;
    this.bindEvents();
  }

  bindEvents() {
    this.fileInput?.addEventListener('change', (event) => this.handleFile(event));
    this.uploadButton?.addEventListener('click', () => this.upload());
    this.predictButton?.addEventListener('click', () => this.predict());
  }

  handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (this.previewImage) {
        this.previewImage.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  }

  getFormData() {
    const file = this.fileInput?.files?.[0];
    if (!file) {
      alert('Please choose an image first.');
      return null;
    }
    const formData = new FormData();
    formData.append('file', file);
    return formData;
  }

  async upload() {
    const formData = this.getFormData();
    if (!formData) return;
    try {
      const response = await fetch(`${LAB_API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      this.lastUploadedFilename = data.filename;
      this.renderResult({
        message: 'Upload successful',
        filename: data.filename,
        original_name: data.original_name,
        uploaded_at: data.uploaded_at,
      });
    } catch (error) {
      console.error(error);
      this.renderResult({ error: 'Upload failed. Check the console for details.' });
    }
  }

  async predict() {
    const formData = this.getFormData();
    if (!formData) return;
    try {
      const response = await fetch(`${LAB_API_BASE}/api/predict`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Prediction failed');
      const payload = await response.json();
      this.renderResult(payload);
    } catch (error) {
      console.error(error);
      this.renderResult({ error: 'Prediction failed. Please retry.' });
    }
  }

  renderResult(result) {
    if (!this.resultBlock) return;
    this.resultBlock.textContent = JSON.stringify(result, null, 2);
  }
}

function initCropLab() {
  const container = document.querySelector('.crop-lab');
  if (container) {
    new CropLab(container);
  }
}

document.addEventListener('DOMContentLoaded', initCropLab);
