(() => {
  const apiBase = '/api/push';
  const permissionAskedKey = 'ginkko_push_permission_asked';
  const accountSettings = {
    'ginkko@palmacodes.cl': {
      statusId: 'pushStatus',
      enableId: 'pushEnable',
      testId: 'pushTest',
      workflowTestId: 'pushWorkflowTest',
      disableId: 'pushDisable'
    },
    'palmacodes@palmacodes.cl': {
      statusId: 'pushOnlyStatus',
      enableId: 'pushOnlyEnable',
      testId: 'pushOnlyTest',
      disableId: 'pushOnlyDisable'
    }
  };
  const savedTokenKey = email => 'ginkko_push_token_' + email;
  const disabledKey = email => 'ginkko_push_disabled_' + email;

  let activeUser = null;
  let messaging = null;
  let vapidKey = null;
  let messagingSupported = null;
  let serviceWorkerRegistration = null;
  let setupPromise = null;

  function setStatus(message, isError) {
    if (!activeUser) return;
    const settings = accountSettings[(activeUser.email || '').toLowerCase()];
    const status = settings && document.getElementById(settings.statusId);
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? '#B42318' : '';
  }

  async function getConfig() {
    const response = await fetch(apiBase + '/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('El servicio de notificaciones no está disponible.');
    const config = await response.json();
    if (typeof config.vapidKey !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(config.vapidKey)) {
      throw new Error('Falta configurar la clave pública de notificaciones.');
    }
    return config;
  }

  async function sendTokenRequest(path, token) {
    const idToken = await activeUser.getIdToken();
    const response = await fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, token })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'No se pudo actualizar este dispositivo.');
    }
    return result;
  }

  async function getDeviceToken() {
    if (!messaging) messaging = firebase.messaging();
    if (!serviceWorkerRegistration) {
      serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    }
    return messaging.getToken({
      vapidKey,
      serviceWorkerRegistration
    });
  }

  async function registerCurrentDevice() {
    const token = await getDeviceToken();
    if (!token) throw new Error('El navegador no pudo registrar este dispositivo para notificaciones.');
    await sendTokenRequest('/register', token);
    const email = (activeUser.email || '').toLowerCase();
    localStorage.setItem(savedTokenKey(email), token);
    localStorage.removeItem(disabledKey(email));
    setStatus('Notificaciones activadas para ' + activeUser.email + ' en este dispositivo.');
  }

  async function enableNotifications() {
    if (!activeUser) return;
    const settings = accountSettings[(activeUser.email || '').toLowerCase()];
    const enableButton = document.getElementById(settings.enableId);
    enableButton.disabled = true;
    setStatus('Preparando este dispositivo…');

    try {
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) {
        throw new Error('Se requiere HTTPS y un navegador Android compatible con notificaciones web.');
      }
      if (messagingSupported === null) {
        messagingSupported = !!firebase.messaging &&
          typeof firebase.messaging.isSupported === 'function' &&
          await firebase.messaging.isSupported();
        if (!messagingSupported) throw new Error('Este navegador no es compatible con notificaciones web push.');
        setStatus('Navegador listo. Toca otra vez para permitir las notificaciones.');
        return;
      }
      if (!messagingSupported) {
        throw new Error('Este navegador no es compatible con notificaciones web push.');
      }

      if (!vapidKey) {
        const config = await getConfig();
        vapidKey = config.vapidKey;
        setStatus('Servicio listo. Toca otra vez para permitir las notificaciones.');
        return;
      }

      if (Notification.permission === 'default') {
        if (localStorage.getItem(permissionAskedKey) === '1') {
          throw new Error('El permiso ya se solicitó. Si fue rechazado o cerrado, actívalo desde los ajustes de notificaciones del navegador.');
        }
        localStorage.setItem(permissionAskedKey, '1');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('No se activaron las notificaciones. Puedes permitirlas desde los ajustes del navegador; no volveremos a mostrar el aviso de permiso.');
        }
      } else if (Notification.permission === 'denied') {
        throw new Error('Las notificaciones están bloqueadas. Actívalas desde los ajustes del navegador y vuelve a iniciar sesión.');
      }

      await registerCurrentDevice();
    } catch (error) {
      setStatus(error.message || 'No se pudo activar este dispositivo.', true);
    } finally {
      enableButton.disabled = false;
    }
  }

  async function disableNotifications() {
    if (!activeUser) return;
    const settings = accountSettings[(activeUser.email || '').toLowerCase()];
    const disableButton = document.getElementById(settings.disableId);
    disableButton.disabled = true;
    setStatus('Desactivando notificaciones en este dispositivo…');

    try {
      if (!messaging) messaging = firebase.messaging();
      const email = (activeUser.email || '').toLowerCase();
      const token = localStorage.getItem(savedTokenKey(email)) ||
        (Notification.permission === 'granted' ? await getDeviceToken() : null);
      if (token) {
        await sendTokenRequest('/unregister', token);
      }
      localStorage.removeItem(savedTokenKey(email));
      localStorage.setItem(disabledKey(email), '1');
      setStatus('Notificaciones desactivadas en este dispositivo.');
    } catch (error) {
      setStatus(error.message || 'No se pudieron desactivar las notificaciones.', true);
    } finally {
      disableButton.disabled = false;
    }
  }

  async function sendTestNotification() {
    if (!activeUser) return;
    const settings = accountSettings[(activeUser.email || '').toLowerCase()];
    const testButton = document.getElementById(settings.testId);
    testButton.disabled = true;
    setStatus('Enviando una prueba solo a esta cuenta…');

    try {
      if (Notification.permission !== 'granted') {
        throw new Error('Primero activa las notificaciones en este dispositivo.');
      }
      const email = (activeUser.email || '').toLowerCase();
      if (localStorage.getItem(disabledKey(email)) === '1') {
        throw new Error('Las notificaciones están desactivadas en este dispositivo. Actívalas de nuevo primero.');
      }
      const token = localStorage.getItem(savedTokenKey(email));
      if (!token) throw new Error('Activa las notificaciones en este dispositivo antes de enviar la prueba.');

      const idToken = await activeUser.getIdToken();
      const response = await fetch(apiBase + '/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, token })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo enviar la prueba.');
      setStatus('Prueba aceptada por Firebase para este dispositivo.');
    } catch (error) {
      setStatus(error.message || 'No se pudo enviar la prueba.', true);
    } finally {
      testButton.disabled = false;
    }
  }

  async function sendWorkflowTest() {
    if (!activeUser) return;
    const email = (activeUser.email || '').toLowerCase();
    const testButton = document.getElementById('pushWorkflowTest');
    testButton.disabled = true;
    setStatus('Enviando la prueba de recordatorio y confirmación…');

    try {
      if (email !== 'ginkko@palmacodes.cl') {
        throw new Error('Esta prueba solo está disponible para la cuenta Ginkko.');
      }
      if (Notification.permission !== 'granted' ||
          localStorage.getItem(disabledKey(email)) === '1') {
        throw new Error('Primero activa las notificaciones de Ginkko en este dispositivo.');
      }
      const token = localStorage.getItem(savedTokenKey(email));
      if (!token) throw new Error('Activa las notificaciones de Ginkko antes de probar el flujo.');

      const idToken = await activeUser.getIdToken();
      const response = await fetch(apiBase + '/test-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, token })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo probar el flujo.');

      if (result.confirmationDevices > 0) {
        setStatus('Prueba aceptada para Ginkko y enviada como confirmación a ' +
          result.confirmationDevices + ' dispositivo(s) de Palmacodes.');
      } else {
        setStatus('Prueba aceptada para Ginkko, pero no hay dispositivos Palmacodes activos para confirmar.', true);
      }
    } catch (error) {
      setStatus(error.message || 'No se pudo probar el flujo.', true);
    } finally {
      testButton.disabled = false;
    }
  }

  async function initializeMessaging() {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) {
      throw new Error('Se requiere HTTPS y un navegador Android compatible con notificaciones web.');
    }
    messagingSupported = !!firebase.messaging &&
      typeof firebase.messaging.isSupported === 'function' &&
      await firebase.messaging.isSupported();
    if (!messagingSupported) {
      throw new Error('Este navegador no es compatible con notificaciones web push.');
    }

    const config = await getConfig();
    vapidKey = config.vapidKey;
    messaging = firebase.messaging();
    messaging.onMessage(payload => {
      const notification = payload.notification || {};
      if (Notification.permission === 'granted' && serviceWorkerRegistration) {
        serviceWorkerRegistration.showNotification(
          notification.title || 'Ginkko Paisajismo',
          {
            body: notification.body || 'Tienes una actualización de pago.',
            icon: '/logoicon.jpeg',
            tag: payload.data && payload.data.tag,
            renotify: false
          }
        );
      }
    });

    const email = (activeUser.email || '').toLowerCase();
    if (Notification.permission === 'granted' && localStorage.getItem(disabledKey(email)) !== '1') {
      await registerCurrentDevice();
    } else if (Notification.permission === 'granted') {
      setStatus('Notificaciones desactivadas en este dispositivo.');
    } else if (Notification.permission === 'denied') {
      setStatus('Permiso bloqueado. Puedes habilitarlo en los ajustes de notificaciones del navegador.');
    } else if (localStorage.getItem(permissionAskedKey) === '1') {
      setStatus('El permiso ya se solicitó. Si el aviso se cerró, habilita notificaciones en los ajustes del navegador.');
    } else {
      setStatus('Activa el permiso una sola vez para recibir avisos en este dispositivo.');
    }
  }

  window.gpSetupPush = user => {
    const email = (user.email || '').toLowerCase();
    if (!accountSettings[email]) return;

    activeUser = user;
    if (setupPromise) return;
    setupPromise = initializeMessaging()
      .catch(error => setStatus(error.message || 'No se pudo preparar el servicio de notificaciones.', true))
      .finally(() => { setupPromise = null; });
  };

  Object.values(accountSettings).forEach(settings => {
    document.getElementById(settings.enableId).addEventListener('click', enableNotifications);
    document.getElementById(settings.testId).addEventListener('click', sendTestNotification);
    document.getElementById(settings.disableId).addEventListener('click', disableNotifications);
  });
  document.getElementById('pushWorkflowTest').addEventListener('click', sendWorkflowTest);
})();
