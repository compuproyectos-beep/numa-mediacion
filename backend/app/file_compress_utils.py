"""
Utilidades para achicar el peso de los PDFs y fotos que se suben a Supabase
Storage (actas finales y comprobantes de pago), sin perder legibilidad.

Dos técnicas distintas, según el tipo de archivo:

- Imágenes (JPG/PNG de comprobantes, normalmente fotos tomadas con el
  celular): se reduce el tamaño si son más grandes de lo necesario para
  leerse en pantalla, y se recomprimen como JPEG con buena calidad. Esto
  es lo que más ahorra, porque una foto de celular suele venir en 3000+
  píxeles de lado y con compresión mínima.

- PDFs (actas finales y comprobantes en PDF): si el PDF fue generado
  digitalmente (texto real, no una foto), se deja el texto intacto
  (sigue siendo seleccionable) y solo se reoptimiza cómo están guardados
  los objetos internos — ahí el ahorro es modesto pero 100% sin riesgo.
  Si el PDF es (o contiene) un escaneo/foto de un documento firmado en
  papel, que es el caso que más pesa, se recomprime esa imagen interna
  igual que se hace con las fotos sueltas (se reduce su resolución si es
  más alta de lo necesario para leerse bien, y se recodifica como JPEG
  con buena calidad). El texto real del PDF nunca se convierte en imagen
  ni se toca — solo las imágenes que ya venían adentro.

Ambas funciones son "a prueba de fallos": si algo sale mal al comprimir
(un archivo corrupto, una imagen en un formato raro, una librería que
falla, etc.), devuelven el archivo original sin tocar, en vez de bloquear
la subida de un documento legal.
"""

import io

from PIL import Image
import pikepdf
from pikepdf import Name

# Lado más largo, en píxeles, al que se reduce una imagen si viene más
# grande. 2000px es de sobra para leer cualquier texto en pantalla o al
# imprimir en tamaño carta/A4.
_LADO_MAXIMO_PX = 2000
_CALIDAD_JPEG = 82
# Un poco más agresiva para las imágenes DENTRO de un PDF (son escaneos,
# no el documento final), pero sigue siendo un nivel donde el texto y los
# sellos/firmas se leen perfectamente bien.
_CALIDAD_JPEG_PDF = 78


def comprimir_imagen(contenido: bytes, content_type: str):
    """
    Recibe los bytes de una imagen (JPG o PNG) y devuelve una tupla
    (contenido_nuevo, content_type_nuevo, extension_nueva).

    Si la imagen no se pudo comprimir, o si la "comprimida" resultó más
    pesada que la original (pasa con imágenes ya muy comprimidas),
    devuelve el original sin tocar y extension_nueva en None (para que
    quien llama sepa que debe seguir usando la extensión original).
    """
    try:
        imagen = Image.open(io.BytesIO(contenido))
        imagen = imagen.convert("RGB")  # JPEG no soporta transparencia (PNG sí)

        ancho, alto = imagen.size
        lado_mayor = max(ancho, alto)

        if lado_mayor > _LADO_MAXIMO_PX:
            factor = _LADO_MAXIMO_PX / lado_mayor
            imagen = imagen.resize(
                (max(1, int(ancho * factor)), max(1, int(alto * factor))),
                Image.LANCZOS,
            )

        salida = io.BytesIO()
        imagen.save(salida, format="JPEG", quality=_CALIDAD_JPEG, optimize=True)
        nuevo_contenido = salida.getvalue()

        if len(nuevo_contenido) >= len(contenido):
            return contenido, content_type, None

        return nuevo_contenido, "image/jpeg", "jpg"

    except Exception as e:
        print(f"⚠️  No se pudo comprimir la imagen, se sube el archivo original: {e}")
        return contenido, content_type, None


def _comprimir_pdf_una(contenido: bytes, lado_maximo: int = _LADO_MAXIMO_PX, calidad: int = _CALIDAD_JPEG_PDF) -> bytes:
    """
    Recomprime las imágenes que haya DENTRO de un PDF (escaneos o fotos
    de documentos firmados) y reoptimiza sus objetos internos. El texto
    real del PDF (si lo tiene) nunca se toca. Devuelve los bytes nuevos,
    o los originales si no se pudo procesar o si el resultado no quedó
    más liviano.
    """
    try:
        pdf = pikepdf.open(io.BytesIO(contenido))

        try:
            for page in pdf.pages:
                for _, raw_image in list(page.images.items()):
                    try:
                        pil_image = pikepdf.PdfImage(raw_image).as_pil_image()
                    except Exception:
                        # Imagen en un formato/espacio de color que no se
                        # pudo decodificar (CMYK poco común, máscara, etc.):
                        # se deja tal cual en vez de arriesgar el archivo.
                        continue

                    ancho, alto = pil_image.size
                    lado_mayor = max(ancho, alto)

                    if lado_mayor > lado_maximo:
                        factor = lado_maximo / lado_mayor
                        pil_image = pil_image.resize(
                            (max(1, int(ancho * factor)), max(1, int(alto * factor))),
                            Image.LANCZOS,
                        )

                    pil_image = pil_image.convert("RGB")

                    buf_imagen = io.BytesIO()
                    pil_image.save(buf_imagen, format="JPEG", quality=calidad)
                    nuevo_bytes_imagen = buf_imagen.getvalue()

                    raw_image.write(nuevo_bytes_imagen, filter=Name("/DCTDecode"))
                    raw_image.ColorSpace = Name("/DeviceRGB")
                    raw_image.Width = pil_image.width
                    raw_image.Height = pil_image.height
                    raw_image.BitsPerComponent = 8

                    if "/DecodeParms" in raw_image:
                        del raw_image.DecodeParms
                    if "/SMask" in raw_image:
                        # Si la imagen tenía transparencia, se pierde (no
                        # afecta la legibilidad de un documento escaneado).
                        del raw_image.SMask

            salida = io.BytesIO()
            pdf.save(
                salida,
                compress_streams=True,
                recompress_flate=True,
                object_stream_mode=pikepdf.ObjectStreamMode.generate,
            )
            nuevo_contenido = salida.getvalue()
        finally:
            pdf.close()

        if len(nuevo_contenido) >= len(contenido):
            return contenido

        return nuevo_contenido

    except Exception as e:
        print(f"⚠️  No se pudo optimizar el PDF, se sube el archivo original: {e}")
        return contenido


# El bucket actas-pdf de Supabase Storage rechaza archivos de más de 20 MB. Un escaneo a alta
# resolución puede quedar por encima aun después de la compresión normal;
# en ese caso se reintenta con pasos cada vez más fuertes hasta bajar del
# límite (el texto y las firmas siguen leyéndose bien).
LIMITE_SEGURO_BYTES = 18 * 1024 * 1024
_PASOS_FUERTES = ((1600, 70), (1300, 62), (1100, 58), (900, 50))


def comprimir_pdf(contenido: bytes) -> bytes:
    resultado = _comprimir_pdf_una(contenido)
    if len(resultado) <= LIMITE_SEGURO_BYTES:
        return resultado
    for lado, calidad in _PASOS_FUERTES:
        intento = _comprimir_pdf_una(contenido, lado, calidad)
        print(f"ℹ️  PDF pesado ({len(resultado) / 1048576:.1f} MB): reintento a {lado}px/calidad {calidad} -> {len(intento) / 1048576:.1f} MB")
        if len(intento) < len(resultado):
            resultado = intento
        if len(resultado) <= LIMITE_SEGURO_BYTES:
            break
    return resultado
