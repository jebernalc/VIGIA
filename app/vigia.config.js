/* VIGÍA · configuración opcional (equivalente a .env.example para la edición de navegador).
 * Copie este archivo como «vigia.config.js» junto a VIGIA.html para ajustar parámetros.
 * NO incluya contraseñas de producción. Si define demoPasswords, úselas sólo para demostraciones. */
window.VIGIA_CONFIG = {
  maxUploadMB: 2048,          // tamaño máximo de archivo importado
  maxIntervaloConsultaH: 24,  // ventana máxima de consulta
  maxClipS: 600,              // duración máxima de clip
  sesionHoras: 8,             // expiración de sesión
  urlTTLmin: 10,              // caducidad de las URL de medios
  pbkdf2Iter: 150000          // iteraciones PBKDF2 para contraseñas
  // demoPasswords: { 'admin@norte.demo': 'cambie-esto', 'admin@sur.demo': 'cambie-esto' }
};
