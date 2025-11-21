if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/custom-sw.js')
        .then(registration => {
            console.log('Service Worker registered:', registration.scope);
            // Use alert here to confirm the registration script ran
            console.log('Dugout Online: Service Worker Registration Script Injected and Ran!');
        })
        .catch(error => {
            console.error('Service Worker registration failed:', error);
            console.log('Dugout Online: Service Worker Registration FAILED!');
        });

    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'SW_STATUS') {
          alert('Service Worker Activated!');
        }
    });
}
