import os
import base64
import requests


# Antes esto mandaba por SMTP (puerto 587). Se cambió a la API HTTPS de
# Resend (https://resend.com) porque el relay SMTP se quedaba "timed out"
# al conectar desde Railway — la API usa HTTPS (puerto 443), el mismo
# puerto por el que ya funciona el resto del sistema, así que no depende de
# que el proveedor de hosting permita el puerto SMTP.
#
# La clave (RESEND_API_KEY) es la misma API key de Resend; si no está esa
# variable configurada en Railway, se reutiliza SMTP_PASSWORD (donde ya
# estaba puesta esa misma clave), para no tener que duplicarla.
_RESEND_URL = "https://api.resend.com/emails"


def _resend_api_key() -> str | None:
    return os.getenv("RESEND_API_KEY") or os.getenv("SMTP_PASSWORD")


def _remitente() -> str:
    email_from = os.getenv("EMAIL_FROM", "onboarding@resend.dev")
    remitente_nombre = os.getenv("EMAIL_REMITENTE_NOMBRE", "Centro de Mediación NUMA")
    return f"{remitente_nombre} <{email_from}>"


def enviar_correo(destinatario: str, asunto: str, cuerpo_html: str) -> bool:
    """
    Envía un correo a través de la API de Resend. Devuelve True si se
    envió, False si falló (y deja el error en consola para poder
    revisarlo, pero nunca interrumpe el flujo que lo llamó).

    Nota: mientras la cuenta de Resend no tenga un dominio propio
    verificado (usando el remitente de prueba "onboarding@resend.dev"),
    Resend solo entrega correos al email con el que se creó la cuenta de
    Resend — no a cualquier destinatario todavía.
    """
    api_key = _resend_api_key()

    if not api_key:
        print(
            "⚠️  RESEND_API_KEY / SMTP_PASSWORD no configurados. "
            "No se envió el correo a:", destinatario
        )
        return False

    try:
        respuesta = requests.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": _remitente(),
                "to": [destinatario],
                "subject": asunto,
                "html": cuerpo_html,
            },
            timeout=20,
        )

        if respuesta.status_code in (200, 201):
            return True

        print(
            f"⚠️  Resend rechazó el correo a {destinatario} "
            f"({respuesta.status_code}): {respuesta.text}"
        )
        return False

    except Exception as e:
        print(f"⚠️  Error enviando correo a {destinatario}: {e}")
        return False


def enviar_correo_con_adjunto(
    destinatario: str,
    asunto: str,
    cuerpo_html: str,
    nombre_adjunto: str,
    contenido_adjunto: bytes,
) -> bool:
    """
    Igual que enviar_correo, pero con un archivo adjunto (por ejemplo, el
    respaldo diario de la base de datos comprimido en .zip). Devuelve True
    si se envió, False si falló, y nunca lanza una excepción hacia quien
    la llama (para no tumbar el proceso que dispara el respaldo).
    """
    api_key = _resend_api_key()

    if not api_key:
        print(
            "⚠️  RESEND_API_KEY / SMTP_PASSWORD no configurados. "
            "No se envió el correo con adjunto a:", destinatario
        )
        return False

    try:
        respuesta = requests.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": _remitente(),
                "to": [destinatario],
                "subject": asunto,
                "html": cuerpo_html,
                "attachments": [
                    {
                        "filename": nombre_adjunto,
                        "content": base64.b64encode(contenido_adjunto).decode("ascii"),
                    }
                ],
            },
            timeout=20,
        )

        if respuesta.status_code in (200, 201):
            return True

        print(
            f"⚠️  Resend rechazó el correo con adjunto a {destinatario} "
            f"({respuesta.status_code}): {respuesta.text}"
        )
        return False

    except Exception as e:
        print(f"⚠️  Error enviando correo con adjunto a {destinatario}: {e}")
        return False


def plantilla_base(titulo: str, mensaje_html: str, boton_texto: str, boton_url: str) -> str:
    """Plantilla HTML simple y consistente para todos los correos del sistema."""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background-color: #0E2338; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: #E0B84A; margin: 0; font-size: 20px; letter-spacing: 1px;">
                CENTRO DE MEDIACIÓN NUMA
            </h1>
        </div>
        <div style="background-color: #ffffff; padding: 32px 24px; border: 1px solid #e5e7eb; border-top: none;">
            <h2 style="color: #0E2338; font-size: 18px; margin-top: 0;">{titulo}</h2>
            <div style="color: #4b5563; font-size: 14px; line-height: 1.6;">
                {mensaje_html}
            </div>
            <div style="text-align: center; margin: 28px 0;">
                <a href="{boton_url}"
                   style="background-color: #E0B84A; color: #0E2338; text-decoration: none;
                          padding: 12px 28px; border-radius: 6px; font-weight: bold;
                          font-size: 14px; display: inline-block;">
                    {boton_texto}
                </a>
            </div>
            <p style="color: #9ca3af; font-size: 12px;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
                <span style="word-break: break-all;">{boton_url}</span>
            </p>
        </div>
        <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
            NUMA · Sistema Integral de Mediación
        </div>
    </div>
    """
