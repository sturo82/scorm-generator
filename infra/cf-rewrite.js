// CloudFront Function (viewer-request) per servire un export statico Next.js
// (output: 'export', trailingSlash: true) da S3 dietro OAC.
//
// S3 via OAC NON fa il lookup automatico dell'index document, quindi mappiamo
// esplicitamente le "directory" al loro index.html:
//   /                -> /index.html
//   /login           -> /login/index.html
//   /courses/new/    -> /courses/new/index.html
//
// Route dinamiche (output:'export' con un solo segnaposto generato da
// generateStaticParams): /courses/<id> e /brands/<id> non hanno un HTML per ogni
// id. Serviamo lo shell "placeholder"; il client legge l'id dall'URL (useParams)
// e risolve i dati via API. L'URL nel browser resta /courses/<id>: riscriviamo
// solo l'URI verso l'origin.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // File con estensione: lascia invariato (asset, immagini, .txt, ecc.).
  if (uri.indexOf('.') !== -1 && !uri.endsWith('/')) {
    return request;
  }

  // Normalizza rimuovendo lo slash finale per il pattern matching.
  var path = uri.endsWith('/') ? uri.slice(0, -1) : uri;

  // Route dinamiche -> shell placeholder. Esclude le sottopagine statiche note
  // (es. /courses/new) e il placeholder stesso.
  var dynamic = [
    { prefix: '/courses/', keep: ['new', 'placeholder'] },
    { prefix: '/brands/', keep: ['new', 'placeholder'] },
  ];
  for (var i = 0; i < dynamic.length; i++) {
    var d = dynamic[i];
    if (path.indexOf(d.prefix) === 0) {
      var rest = path.slice(d.prefix.length);
      // Solo un segmento (nessuno "/" ulteriore) e non una sottopagina nota.
      if (rest.length > 0 && rest.indexOf('/') === -1 && d.keep.indexOf(rest) === -1) {
        request.uri = d.prefix + 'placeholder/index.html';
        return request;
      }
    }
  }

  // Caso generale: /path -> /path/index.html ; / -> /index.html
  request.uri = (path === '' ? '' : path) + '/index.html';
  return request;
}
