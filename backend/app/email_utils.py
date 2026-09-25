import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr


def enviar_correo(destinatario: str, asunto: str, cuerpo_html: str) -> bool:
    """
    Envía un correo por SMTP (funciona con Gmail, GMX, o cualquier proveedor
    que soporte SMTP estándar — solo cambia las variables de entorno).
    Devuelve True si se envió, False si falló (y deja el error en consola
    para poder revisarlo, pero nunca interrumpe el flujo que lo llamó).
    """
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    email_from = os.getenv("EMAIL_FROM", smtp_user)
    remitente_nombre = os.getenv("EMAIL_REMITENTE_NOMBRE", "Centro de Mediación NUMA")

    if not smtp_user or not smtp_password:
        print(
            "⚠️  SMTP_USER / SMTP_PASSWORD no configurados. "
            "No se envió el correo a:", destinatario
        )
        return False

    mensaje = MIMEMultipart("alternative")
    mensaje["Subject"] = asunto
    mensaje["From"] = formataddr((str(Header(remitente_nombre, "utf-8")), email_from))
    mensaje["To"] = destinatario

    mensaje.attach(MIMEText(cuerpo_html, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as servidor:
            servidor.starttls()
            servidor.login(smtp_user, smtp_password)
            servidor.sendmail(email_from, destinatario, mensaje.as_string())
        return True
    except Exception as e:
        print(f"⚠️  Error enviando correo a {destinatario}: {e}")
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
