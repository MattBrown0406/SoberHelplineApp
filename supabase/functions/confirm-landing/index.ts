// Public landing page for Supabase auth email links (signup confirmation).
//
// Why this exists: without a redirect target, Supabase forwards users to the
// project Site URL after verifying their email — which defaulted to
// localhost:3000 and dead-ended every new user ("site can't be reached").
// This page is the destination instead: it confirms success, offers a deep
// link back into the app, and explains expired links.
//
// Deploy with:  supabase functions deploy confirm-landing --no-verify-jwt
// (--no-verify-jwt is REQUIRED — email links arrive with no auth header.)
//
// Then in Supabase Dashboard → Authentication → URL Configuration:
//   Site URL:      https://<project-ref>.supabase.co/functions/v1/confirm-landing
//   Redirect URLs: add the same URL to the allow-list

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sober Helpline</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fbf6ee; color: #22302f;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; text-align: center;
  }
  .card {
    background: #fff; border-radius: 24px; padding: 40px 28px; max-width: 420px; width: 100%;
    box-shadow: 0 2px 24px rgba(34,48,47,.08);
  }
  .icon { font-size: 56px; margin-bottom: 18px; }
  h1 { font-size: 24px; letter-spacing: -0.4px; margin-bottom: 12px; }
  p { font-size: 15.5px; line-height: 23px; color: #5c6a68; margin-bottom: 10px; }
  .btn {
    display: inline-block; margin-top: 18px; background: #33543f; color: #fff;
    text-decoration: none; font-weight: 700; font-size: 16px;
    padding: 15px 34px; border-radius: 14px;
  }
  .hint { font-size: 12.5px; color: #9aa5a3; margin-top: 16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon" id="icon">✅</div>
    <h1 id="title">You're confirmed</h1>
    <p id="body">Your email is verified. Open the Sober Helpline app on your phone and sign in — your account is ready.</p>
    <a class="btn" id="btn" href="sober-helpline://">Open the app</a>
    <p class="hint" id="hint">If the button doesn't work, just open Sober Helpline from your home screen.</p>
  </div>
<script>
(function () {
  var es = (navigator.language || '').toLowerCase().indexOf('es') === 0;
  var params = new URLSearchParams(
    (location.hash && location.hash.length > 1 ? location.hash.substring(1) + '&' : '') +
    location.search.replace(/^\\?/, '')
  );
  var error = params.get('error') || params.get('error_code');
  var t = {
    okTitle: es ? 'Cuenta confirmada' : "You're confirmed",
    okBody: es
      ? 'Tu correo está verificado. Abre la aplicación Sober Helpline en tu teléfono e inicia sesión — tu cuenta está lista.'
      : 'Your email is verified. Open the Sober Helpline app on your phone and sign in — your account is ready.',
    errTitle: es ? 'Este enlace ya no es válido' : 'This link has expired',
    errBody: es
      ? 'Los enlaces de confirmación funcionan una sola vez y caducan. Abre la aplicación e intenta iniciar sesión — es posible que tu cuenta ya esté confirmada. Si no, regístrate de nuevo para recibir un enlace nuevo.'
      : 'Confirmation links work once and expire. Open the app and try signing in — your account may already be confirmed. If not, sign up again to get a fresh link.',
    btn: es ? 'Abrir la aplicación' : 'Open the app',
    hint: es
      ? 'Si el botón no funciona, abre Sober Helpline desde tu pantalla de inicio.'
      : "If the button doesn't work, just open Sober Helpline from your home screen.",
  };
  document.getElementById('btn').textContent = t.btn;
  document.getElementById('hint').textContent = t.hint;
  if (error) {
    document.getElementById('icon').textContent = '⏳';
    document.getElementById('title').textContent = t.errTitle;
    document.getElementById('body').textContent = t.errBody;
  } else {
    document.getElementById('title').textContent = t.okTitle;
    document.getElementById('body').textContent = t.okBody;
  }
})();
</script>
</body>
</html>`;

Deno.serve(() => {
  return new Response(PAGE, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
});
