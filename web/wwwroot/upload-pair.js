const origin = 'https://fishnship.mercantec.tech';
const requestId = location.hash.slice(1);
const opener = window.opener;
const approveButton = document.querySelector('#approve');
const status = document.querySelector('#approval-status');

if (opener && /^[a-f0-9-]{36}$/i.test(requestId)) {
  approveButton.disabled = false;
} else {
  status.textContent = 'Open this window using Find port in FishNShip.';
}

approveButton.addEventListener('click', async () => {
  approveButton.disabled = true;
  try {
    const request = path => fetch(`/api/firmware/${path}`, {
      method: 'POST',
      headers: { 'X-Lager-Editor': '1' },
    });
    const [keyResponse, portsResponse] = await Promise.all([request('bridge-key'), request('ports')]);
    if (!keyResponse.ok) throw new Error('Start the local .NET app on the computer connected to the Arduino.');
    if (!portsResponse.ok) throw new Error('Could not read the port list. Check the local Arduino CLI.');
    const { key } = await keyResponse.json();
    const ports = await portsResponse.json();
    opener.postMessage({ type: 'fishnship-upload-approved', requestId, key, ports }, origin);
    status.textContent = 'Authorized. Return to FishNShip.';
    window.close();
  } catch (error) {
    status.textContent = error.message;
    approveButton.disabled = false;
  }
});
