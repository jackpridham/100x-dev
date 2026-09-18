const toggle = document.getElementById('toggle-switch');
const status = document.getElementById('toggle-status');

// Load saved state
chrome.storage.sync.get('threadcopyEnabled', function(data) {
  const enabled = data.threadcopyEnabled !== false;
  toggle.checked = enabled;
  updateStatus(enabled);
});

toggle.addEventListener('change', function() {
  const enabled = toggle.checked;
  chrome.storage.sync.set({ threadcopyEnabled: enabled });
  updateStatus(enabled);
});

function updateStatus(enabled) {
  status.textContent = enabled ? 'Active' : 'Paused';
  status.className = 'toggle-status ' + (enabled ? 'on' : 'off');
}
