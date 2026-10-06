import { deflateSync } from 'node:zlib';
import {
  baseJpeg,
  buildExif,
  cat,
  commentSegment,
  enc,
  exifSegment,
  iccSegments,
  insertSegments,
  latin,
  photoshopSegment,
  segment,
  SYNTH_XMP,
  syntheticIcc,
  xmpSegment,
  xmpPacket,
  withJfifThumbnail,
} from './jpeg';
import { buildPng, chunk, iccpChunk, ihdr, iend, itxtChunk, PNG_SIG, idatSplit, physChunk, textChunk, timeChunk, ztxtChunk, idatFor } from './png';
import { basicPdf, PdfWriter, SYNTH_INFO } from './pdf';
import { TiffBuilder } from './tiff';

export interface FixtureSpec {
  file: string;
  description: string;
  bytes: Uint8Array;
}

const GPS = { lat: 0.25, lon: 0.75, alt: 12.5, date: '2000:01:01' };
const EXIF_FULL = {
  make: 'Example Maker',
  model: 'Fixture Camera One',
  software: 'Fixture Editor 1.0',
  datetime: '2000:01:02 03:04:05',
  original: '2000:01:01 00:00:00',
  artist: 'Example Person',
  copyright: 'Example Person (fixture)',
  description: 'Synthetic fixture image',
  lens: 'Fixture Lens 50mm',
  serial: 'FIXTURE-0000',
  owner: 'Example Person',
  userComment: 'Synthetic user comment',
  makerNote: true,
  xpAuthor: 'Example Person',
};

/** Hostile-but-inert metadata for rendering tests: markup, bidi controls, control chars. */
export const HOSTILE = {
  markup: '<img src=x onerror=alert(1)><script>alert(2)</script>',
  bidi: 'fixture\u202eevil\u202c name \u2066x\u2069',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(3)"></svg>',
};

export function buildFixtures(): FixtureSpec[] {
  const out: FixtureSpec[] = [];
  const add = (file: string, description: string, bytes: Uint8Array): void => {
    out.push({ file, description, bytes });
  };

  // ------------------------------------------------------------------ JPEG
  const base = baseJpeg();
  const thumb = baseJpeg(8, 6, 50);
  add('jpeg-clean.jpg', 'JPEG with only a JFIF header: no hidden metadata expected.', base);
  add('jpeg-exif.jpg', 'EXIF with fictional device, software, dates and names (no GPS).', insertSegments(base, [exifSegment(buildExif(EXIF_FULL))]));
  add('jpeg-exif-le.jpg', 'Same EXIF written little-endian.', insertSegments(base, [exifSegment(buildExif({ ...EXIF_FULL, le: true }))]));
  add('jpeg-gps.jpg', 'EXIF with a clearly synthetic GPS position (0.25 N, 0.75 E).', insertSegments(base, [exifSegment(buildExif({ make: 'Example Maker', model: 'Fixture Camera One', gps: GPS }))]));
  add('jpeg-orientation6.jpg', 'EXIF orientation 6 (rotate 90 degrees) and nothing else.', insertSegments(base, [exifSegment(buildExif({ orientation: 6 }))]));
  add('jpeg-thumbnail.jpg', 'EXIF with an embedded thumbnail JPEG.', insertSegments(base, [exifSegment(buildExif({ make: 'Example Maker', thumbnail: thumb }))]));
  add('jpeg-jfif-thumbnail.jpg', 'JFIF header with a 2 x 2 embedded thumbnail.', withJfifThumbnail(base, 2, 2));
  add('jpeg-xmp.jpg', 'XMP packet with creator, tool, dates, document ID and city.', insertSegments(base, [xmpSegment(SYNTH_XMP)]));
  add('jpeg-comment.jpg', 'JPEG comment segment.', insertSegments(base, [commentSegment('Synthetic comment by Example Person')]));
  add('jpeg-icc.jpg', 'Embedded synthetic ICC profile.', insertSegments(base, iccSegments(syntheticIcc())));
  add(
    'jpeg-iptc.jpg',
    'Photoshop block with IPTC creator, caption, keywords, place and a thumbnail resource.',
    insertSegments(base, [photoshopSegment([[80, 'Example Person'], [120, 'Synthetic caption'], [25, 'fixture'], [90, 'Fixture City'], [101, 'Fixtureland'], [55, '20000101'], [116, 'Example Person (fixture)']], true)]),
  );
  add(
    'jpeg-kitchen-sink.jpg',
    'All metadata kinds together, an application segment, MPF-like segment and trailing data. Orientation 6.',
    cat(
      insertSegments(base, [
        exifSegment(buildExif({ ...EXIF_FULL, gps: GPS, orientation: 6, thumbnail: thumb })),
        xmpSegment(SYNTH_XMP),
        ...iccSegments(syntheticIcc()),
        photoshopSegment([[80, 'Example Person'], [120, 'Synthetic caption']]),
        commentSegment('Synthetic comment'),
        segment(0xe5, cat(latin('FixtureApp\0'), enc('private payload'))),
        segment(0xe2, cat(latin('MPF\0'), new Uint8Array(24))),
      ]),
      enc('TRAILING-SYNTHETIC-DATA'),
    ),
  );
  add('jpeg-trailing.jpg', 'Bytes after the end-of-image marker.', cat(base, latin('PK\u0003\u0004fixture-trailing-bytes')));
  add(
    'jpeg-duplicate-segments.jpg',
    'Two EXIF segments, two XMP packets, two comments.',
    insertSegments(base, [
      exifSegment(buildExif({ make: 'Example Maker' })),
      exifSegment(buildExif({ make: 'Second Maker' })),
      xmpSegment(SYNTH_XMP),
      xmpSegment(xmpPacket('<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Second Person</rdf:li></rdf:Seq></dc:creator></rdf:Description>')),
      commentSegment('first'),
      commentSegment('second'),
    ]),
  );
  add('jpeg-truncated.jpg', 'Valid JPEG cut in the middle of image data.', insertSegments(base, [exifSegment(buildExif({ make: 'Example Maker' }))]).subarray(0, 700));
  add('jpeg-invalid-length.jpg', 'An APP1 segment declares a length far beyond the end of the file.', cat(base.subarray(0, 20), Uint8Array.of(0xff, 0xe1, 0xff, 0xf0), latin('Exif\0\0'), base.subarray(20, 120)));
  add('jpeg-tiny-length.jpg', 'A segment declares a length smaller than its own length field.', cat(base.subarray(0, 2), Uint8Array.of(0xff, 0xe1, 0x00, 0x01), base.subarray(2)));
  add('jpeg-fake-extension.png', 'JPEG content stored under a .png name.', base);
  add(
    'jpeg-extreme-dimensions.jpg',
    'Frame header declares 65535 x 65535 pixels with almost no data (decode must be refused).',
    cat(
      Uint8Array.of(0xff, 0xd8),
      segment(0xdb, cat(Uint8Array.of(0), new Uint8Array(64).fill(16))),
      segment(0xc0, Uint8Array.of(8, 0xff, 0xff, 0xff, 0xff, 1, 1, 0x11, 0)),
      segment(0xc4, cat(Uint8Array.of(0), Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), Uint8Array.of(0))),
      segment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
      Uint8Array.of(0x00, 0x00),
      Uint8Array.of(0xff, 0xd9),
    ),
  );
  add(
    'jpeg-hostile-metadata.jpg',
    'Metadata strings containing markup, bidi controls and control characters (must render as text).',
    insertSegments(base, [
      exifSegment(buildExif({ artist: HOSTILE.markup, description: HOSTILE.bidi, software: 'x\u0001\u0002y' })),
      commentSegment(HOSTILE.svg),
      xmpSegment(xmpPacket(`<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>${HOSTILE.markup.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</rdf:li></rdf:Seq></dc:creator></rdf:Description>`)),
    ]),
  );

  // ------------------------------------------------------------------ PNG
  const iccp = iccpChunk('Example Profile', syntheticIcc());
  const tw = new TiffBuilder(false);
  const pngExif = tw.build([
    { name: 'ifd0', entries: [tw.ascii(0x010f, 'Example Maker'), tw.ascii(0x0110, 'Fixture Camera One'), tw.ptr(0x8825, 'gps')] },
    { name: 'gps', entries: [tw.ascii(1, 'N'), tw.rationals(2, [[0, 1], [15, 1], [0, 1]]), tw.ascii(3, 'E'), tw.rationals(4, [[0, 1], [45, 1], [0, 1]])] },
  ]);
  add('png-clean.png', 'PNG with only required chunks.', buildPng());
  add(
    'png-text.png',
    'tEXt entries: Author, Software, Comment, Creation Time.',
    buildPng({ before: [textChunk('Author', 'Example Person'), textChunk('Software', 'Fixture Editor 1.0'), textChunk('Comment', 'Synthetic comment'), textChunk('Creation Time', '2000-01-01T00:00:00Z')] }),
  );
  add('png-ztxt.png', 'Compressed zTXt entry.', buildPng({ before: [ztxtChunk('Description', 'Compressed synthetic description by Example Person')] }));
  add('png-itxt.png', 'International iTXt entries (UTF-8, one compressed).', buildPng({ before: [itxtChunk('Title', 'Título de ejemplo ✓ — 例', { lang: 'es', translated: 'Título' }), itxtChunk('Comment', 'Comentario comprimido ✓', { compressed: true, lang: 'es' })] }));
  add('png-exif.png', 'eXIf chunk with device and a synthetic GPS position.', buildPng({ before: [chunk('eXIf', pngExif)] }));
  add('png-time.png', 'tIME chunk.', buildPng({ before: [timeChunk(2000, 1, 2, 3, 4, 5)] }));
  add('png-icc.png', 'iCCP chunk with a synthetic profile.', buildPng({ before: [iccp] }));
  add('png-phys.png', 'pHYs chunk (72 dpi).', buildPng({ before: [physChunk(2835)] }));
  add('png-xmp.png', 'XMP packet in an iTXt chunk.', buildPng({ before: [itxtChunk('XML:com.adobe.xmp', SYNTH_XMP)] }));
  add('png-unknown-chunk.png', 'Private ancillary chunk and a C2PA-named chunk.', buildPng({ before: [chunk('zzZz', enc('private fixture data')), chunk('caBX', enc('not real content credentials'))] }));
  add('png-text-malformed.png', 'tEXt chunks with no keyword terminator and with an empty keyword.', buildPng({ before: [chunk('tEXt', latin('no keyword terminator secret text')), chunk('tEXt', cat(Uint8Array.of(0), latin('empty keyword')))] }));
  add('png-bad-crc.png', 'A tEXt chunk with a wrong checksum.', buildPng({ before: [chunk('tEXt', cat(latin('Author'), Uint8Array.of(0), latin('Example Person')), { badCrc: true })] }));
  add('png-bad-length.png', 'A chunk declares a length far beyond the end of the file.', cat(PNG_SIG, ihdr(64, 48), chunk('tEXt', latin('Comment\0x'), { lengthOverride: 0x7fffff00 }), idatFor(64, 48), iend()));
  add('png-trailing.png', 'Bytes after IEND.', buildPng({ tail: latin('PK\u0003\u0004fixture-trailing-bytes') }));
  add('png-truncated.png', 'PNG cut in the middle of image data.', buildPng({ before: [textChunk('Author', 'Example Person')] }).subarray(0, 150));
  add('png-fake-extension.jpg', 'PNG content stored under a .jpg name.', buildPng());
  add(
    'png-extreme-dimensions.png',
    'IHDR declares 2,147,483,647 x 2,147,483,647 pixels (decode must be refused).',
    cat(PNG_SIG, ihdr(0x7fffffff, 0x7fffffff), chunk('IDAT', Uint8Array.from(deflateSync(new Uint8Array(16)))), iend()),
  );
  add(
    'png-zbomb.png',
    'zTXt entry that expands to 20 MiB of zeros (decompression must be capped).',
    buildPng({ before: [ztxtChunk('Comment', new Uint8Array(20 * 1024 * 1024))] }),
  );
  add(
    'png-out-of-order.png',
    'Duplicate pHYs chunks and IDAT chunks separated by a text chunk (specification violations).',
    cat(PNG_SIG, ihdr(64, 48), physChunk(2835), physChunk(3000), idatSplit(64, 48)[0], textChunk('Comment', 'between data'), idatSplit(64, 48)[1], iend()),
  );
  add(
    'png-kitchen-sink.png',
    'Text, compressed text, iTXt, XMP, EXIF, time, ICC, pHYs, unknown chunk and trailing data.',
    buildPng({
      before: [iccp, physChunk(2835), textChunk('Author', 'Example Person'), ztxtChunk('Description', 'Compressed synthetic description'), itxtChunk('Title', 'Título ✓'), itxtChunk('XML:com.adobe.xmp', SYNTH_XMP), chunk('eXIf', pngExif), timeChunk(2000, 1, 2, 3, 4, 5), chunk('zzZz', enc('private'))],
      tail: latin('TRAILING-SYNTHETIC-DATA'),
    }),
  );
  add(
    'png-hostile-metadata.png',
    'Text values containing markup, bidi controls and control characters (must render as text).',
    buildPng({ before: [textChunk('Comment', HOSTILE.markup), itxtChunk('Title', HOSTILE.bidi), textChunk('Software', 'x\u0001y')] }),
  );

  // ------------------------------------------------------------------ PDF
  add('pdf-basic.pdf', 'Info dictionary with title, author, subject, keywords, creator, producer, dates and a document ID.', basicPdf({ infoOverrides: SYNTH_INFO }).w.bytes());
  add(
    'pdf-xmp.pdf',
    'Info dictionary plus an XMP metadata stream.',
    basicPdf({ infoOverrides: SYNTH_INFO, extraCatalog: '/Metadata 7 0 R', streams: [[7, '/Type /Metadata /Subtype /XML', SYNTH_XMP]] }).w.bytes(),
  );
  add(
    'pdf-annotation.pdf',
    'A text annotation with an author.',
    basicPdf({ infoOverrides: SYNTH_INFO, extraPage: '/Annots [7 0 R]', extraObjects: [[7, '<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Synthetic note) /T (Example Person) /M (D:20000101000000Z) >>']] }).w.bytes(),
  );
  add(
    'pdf-form.pdf',
    'An AcroForm with a text field holding a value.',
    basicPdf({
      extraCatalog: '/AcroForm << /Fields [7 0 R] /DA (/Helv 0 Tf 0 g) >>',
      extraPage: '/Annots [7 0 R]',
      extraObjects: [[7, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (fixture_field) /V (Example value) /Rect [10 10 150 30] /P 3 0 R >>']],
    }).w.bytes(),
  );
  add(
    'pdf-attachment.pdf',
    'An embedded file attachment (a small text file).',
    basicPdf({
      extraCatalog: '/Names << /EmbeddedFiles << /Names [(fixture.txt) 8 0 R] >> >>',
      extraObjects: [[8, '<< /Type /Filespec /F (fixture.txt) /UF (fixture.txt) /EF << /F 7 0 R >> >>']],
      streams: [[7, '/Type /EmbeddedFile', 'synthetic attachment content']],
    }).w.bytes(),
  );
  add(
    'pdf-javascript.pdf',
    'Document-open action containing inert JavaScript (never executed by this tool).',
    basicPdf({ extraCatalog: '/OpenAction 7 0 R', extraObjects: [[7, '<< /S /JavaScript /JS (app.alert\\("synthetic fixture"\\);) >>']] }).w.bytes(),
  );
  add(
    'pdf-link-actions.pdf',
    'A link annotation with a URI action to a non-routable example address, and a Launch action object.',
    basicPdf({
      extraPage: '/Annots [7 0 R]',
      extraObjects: [
        [7, '<< /Type /Annot /Subtype /Link /Rect [10 10 100 30] /A << /S /URI /URI (https://example.invalid/fixture) >> >>'],
        [8, '<< /S /Launch /F (fixture.exe) >>'],
      ],
    }).w.bytes(),
  );
  add(
    'pdf-encrypted.pdf',
    'Declares standard encryption (the dictionary is synthetic; no real content is protected).',
    basicPdf({
      extraObjects: [[7, `<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'11'.repeat(32)}> /P -4 >>`]],
      trailerExtra: '/Encrypt 7 0 R',
    }).w.bytes(),
  );
  // Incremental update: a second revision that changes the Info dictionary.
  {
    const { w } = basicPdf({ infoOverrides: '/Title (Original title) /Author (Example Person)' });
    const prev = w.lastXref;
    w.obj(6, '<< /Title (Revised title) /Author (Example Person) /Producer (Fixture PDF Library 1.0) >>');
    w.finish(7, '/Root 1 0 R /Info 6 0 R', { prev, only: [6] });
    add('pdf-incremental.pdf', 'Two revisions: an incremental update replaced the Info dictionary.', w.bytes());
  }
  add('pdf-truncated.pdf', 'Valid PDF cut before the cross-reference table.', basicPdf({ infoOverrides: SYNTH_INFO }).w.bytes().subarray(0, 520));
  add('pdf-malformed.pdf', 'Header followed by structure-like garbage.', latin('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ngarbage << >> [[[ \n/trailer << /Root 1 0 R >>\n%%EOF\n'));
  add('pdf-count-mismatch.pdf', 'Declares 100000 pages in /Count but contains one.', basicPdf({ pagesCount: 100000 }).w.bytes());
  {
    const w = new PdfWriter();
    const pages = 300;
    w.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    w.obj(2, `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages} >>`);
    for (let i = 0; i < pages; i++) w.obj(3 + i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>');
    w.finish(3 + pages, '/Root 1 0 R');
    add('pdf-many-pages.pdf', '300 real (blank) pages: per-page inspection must stop at its limit.', w.bytes());
  }
  add(
    'pdf-layers.pdf',
    'Optional content: one layer that is switched off by default.',
    basicPdf({ extraCatalog: '/OCProperties << /OCGs [7 0 R] /D << /OFF [7 0 R] /Order [7 0 R] >> >>', extraObjects: [[7, '<< /Type /OCG /Name (Fixture hidden layer) >>']] }).w.bytes(),
  );
  add('pdf-fake-extension.jpg', 'PDF content stored under a .jpg name.', basicPdf({ infoOverrides: SYNTH_INFO }).w.bytes());
  add(
    'pdf-hostile-metadata.pdf',
    'Info strings containing markup (must render as text).',
    basicPdf({ infoOverrides: `/Title (${HOSTILE.markup.replace(/[()\\]/g, '')}) /Author (${HOSTILE.svg.replace(/[()\\]/g, '')})` }).w.bytes(),
  );
  {
    const w = new PdfWriter('1.4');
    w.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    w.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    w.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>');
    w.finish(4, '/Root 1 0 R');
    add('pdf-minimal.pdf', 'Smallest valid page tree with no metadata.', w.bytes());
  }

  // ------------------------------------------------------------------ other
  add('unsupported.gif', 'A GIF header (recognised but unsupported).', latin('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;'));
  add('unsupported.txt', 'Plain text (unrecognised content).', enc('This is a plain text file used as an unsupported-format fixture.\n'));
  add('empty.bin', 'Zero bytes.', new Uint8Array(0));
  return out;
}
