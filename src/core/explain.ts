import type { Category, TransformationSupport } from './types';

export interface CatalogEntry {
  category: Category;
  label: string;
  /** Plain-language reason this might matter. Calm, never alarmist, no assumptions about intent. */
  privacy: string;
  /** Removal option that governs this finding in the experimental copy. */
  group?: string;
  /** Default when the finding has a group but a given copy does not remove it. */
  transformation?: TransformationSupport;
  limitations?: string[];
}

const TIME_NOTE =
  'Dates can show when a file was created or edited. Camera and software clocks may be wrong or set to a different time zone.';
const NOT_PRIVATE =
  'This describes how the file is stored or displayed. It is usually ordinary and does not identify a person by itself.';

/**
 * Explanations are kept apart from parsing: parsers emit a code and a value; this catalogue says
 * what the code means. Wording is reviewed as product copy (see docs/CLAIMS.md).
 */
export const CATALOG: Record<string, CatalogEntry> = {
  // ---- file level
  'file.type-mismatch': {
    category: 'structural',
    label: 'File name or declared type does not match the content',
    privacy:
      'The tool identified the file from its content, not from its name. A mismatch is common after renaming and is not a sign of harm by itself, but other software may treat the file differently.',
  },
  'image.dimensions': { category: 'structural', label: 'Image size', privacy: NOT_PRIVATE },
  'image.extreme-dimensions': {
    category: 'structural',
    label: 'Very large declared image size',
    privacy:
      'The file declares an image size larger than this tool will decode. Preview and visual comparison are disabled, and no copy is offered because it could not be checked.',
  },

  // ---- EXIF
  'exif.gps-position': {
    category: 'location',
    label: 'GPS position',
    privacy:
      'Coordinates can point to where the photo was taken, which may be a home, workplace or other place you did not intend to share.',
    group: 'exif',
  },
  'exif.gps-altitude': {
    category: 'location',
    label: 'GPS altitude',
    privacy: 'Altitude adds detail to a location and can help narrow down where a photo was taken.',
    group: 'exif',
  },
  'exif.gps-other': {
    category: 'location',
    label: 'Other GPS fields',
    privacy: 'Direction, speed, time stamps and similar GPS fields add context about where and when a photo was taken.',
    group: 'exif',
  },
  'exif.make': {
    category: 'device-software',
    label: 'Camera or device maker',
    privacy: 'The maker can reveal what kind of device was used. It is common, but it contributes to a device fingerprint.',
    group: 'exif',
  },
  'exif.model': {
    category: 'device-software',
    label: 'Camera or device model',
    privacy: 'The model can reveal the exact device used, which can help link photos taken by the same device.',
    group: 'exif',
  },
  'exif.lens': {
    category: 'device-software',
    label: 'Lens',
    privacy: 'Lens details describe the equipment used and can help link photos to the same kit.',
    group: 'exif',
  },
  'exif.serial': {
    category: 'identity',
    label: 'Device serial number',
    privacy: 'A serial number identifies one specific camera or lens and can link photos to the same physical device.',
    group: 'exif',
  },
  'exif.owner': {
    category: 'identity',
    label: 'Camera owner name',
    privacy: 'A name stored by the camera can identify the person who owns or used it.',
    group: 'exif',
  },
  'exif.artist': {
    category: 'identity',
    label: 'Artist or author',
    privacy: 'A name stored in the file can identify its creator.',
    group: 'exif',
  },
  'exif.copyright': {
    category: 'identity',
    label: 'Copyright notice',
    privacy: 'Copyright text often contains a person or organisation name. You may want it to stay if you are crediting the work.',
    group: 'exif',
  },
  'exif.software': {
    category: 'device-software',
    label: 'Software',
    privacy: 'Names the program or firmware that wrote or edited the file. Common, but it shows which tools were used.',
    group: 'exif',
  },
  'exif.datetime': { category: 'time', label: 'Date and time (modified)', privacy: TIME_NOTE, group: 'exif' },
  'exif.datetime-original': { category: 'time', label: 'Date and time (captured)', privacy: TIME_NOTE, group: 'exif' },
  'exif.datetime-digitized': { category: 'time', label: 'Date and time (digitized)', privacy: TIME_NOTE, group: 'exif' },
  'exif.timezone-offset': { category: 'time', label: 'Time zone offset', privacy: TIME_NOTE, group: 'exif' },
  'exif.description': {
    category: 'document-properties',
    label: 'Image description',
    privacy: 'Free text written by a person or program. It can contain names, places or other details.',
    group: 'exif',
  },
  'exif.user-comment': {
    category: 'document-properties',
    label: 'User comment',
    privacy: 'Free text written by a person or program. It can contain names, places or other details.',
    group: 'exif',
  },
  'exif.xp-field': {
    category: 'identity',
    label: 'Windows property',
    privacy: 'Windows can store title, author, comment, keyword and subject text here. Authors and comments may identify people.',
    group: 'exif',
  },
  'exif.unique-id': {
    category: 'identity',
    label: 'Unique image ID',
    privacy: 'A unique identifier can link copies of the same image.',
    group: 'exif',
  },
  'exif.makernote': {
    category: 'unsupported',
    label: 'Manufacturer-specific data (MakerNote)',
    privacy:
      'Camera makers store private data here that can include serial numbers, settings or other details. Its format is not public for most brands, so this tool does not decode it.',
    group: 'exif',
    limitations: ['The contents were not decoded. Only the presence and size are known.'],
  },
  'exif.orientation': {
    category: 'structural',
    label: 'Orientation',
    privacy:
      'Tells viewers how to rotate the image for display. It is not private, and the experimental copy keeps it so the picture is not turned sideways.',
    transformation: 'preserved',
  },
  'exif.thumbnail': {
    category: 'embedded-content',
    label: 'Embedded thumbnail',
    privacy:
      'A small preview image stored inside the metadata. It can show an earlier version of the picture, for example before it was cropped.',
    group: 'exif',
    limitations: ['The thumbnail image itself was located but not decoded or inspected for further metadata.'],
  },
  'exif.other-tags': {
    category: 'unsupported',
    label: 'Other EXIF fields not itemised',
    privacy: 'These fields were present but this tool does not describe them individually.',
    group: 'exif',
  },
  'exif.malformed': {
    category: 'structural',
    label: 'EXIF data is malformed',
    privacy: 'The EXIF block could not be read completely. Some values may be missing from this report.',
    group: 'exif',
  },

  // ---- XMP
  'xmp.packet': {
    category: 'document-properties',
    label: 'XMP metadata packet',
    privacy: 'XMP is a text-based metadata block used by many editing programs. It can carry authors, tools, history and identifiers.',
    group: 'xmp',
    limitations: ['Only well-known XMP properties are itemised; other properties are not described.'],
  },
  'xmp.creator': {
    category: 'identity',
    label: 'Creator',
    privacy: 'A name stored in the file can identify its creator.',
    group: 'xmp',
  },
  'xmp.rights': {
    category: 'identity',
    label: 'Rights statement',
    privacy: 'Rights text often contains a person or organisation name.',
    group: 'xmp',
  },
  'xmp.tool': {
    category: 'device-software',
    label: 'Creator tool',
    privacy: 'Names the program that created the file.',
    group: 'xmp',
  },
  'xmp.agent': {
    category: 'device-software',
    label: 'Software agent in edit history',
    privacy: 'An edit history can show which programs were used and in what order.',
    group: 'xmp',
  },
  'xmp.date': { category: 'time', label: 'XMP date', privacy: TIME_NOTE, group: 'xmp' },
  'xmp.title': {
    category: 'document-properties',
    label: 'Title',
    privacy: 'A title can describe the content or reveal a project or person name.',
    group: 'xmp',
  },
  'xmp.description': {
    category: 'document-properties',
    label: 'Description',
    privacy: 'Free text that can contain names, places or other details.',
    group: 'xmp',
  },
  'xmp.keywords': {
    category: 'document-properties',
    label: 'Keywords',
    privacy: 'Keywords can reveal subjects, places or projects.',
    group: 'xmp',
  },
  'xmp.document-id': {
    category: 'identity',
    label: 'Document or instance identifier',
    privacy: 'Unique identifiers can link copies and versions of the same file.',
    group: 'xmp',
  },
  'xmp.device': {
    category: 'device-software',
    label: 'Camera or device in XMP',
    privacy: 'The device make or model can help link photos to the same equipment.',
    group: 'xmp',
  },
  'xmp.location': {
    category: 'location',
    label: 'Location in XMP',
    privacy: 'City, region, country or GPS values can reveal where a photo was taken.',
    group: 'xmp',
  },
  'xmp.extended': {
    category: 'document-properties',
    label: 'Extended XMP segments',
    privacy: 'Additional XMP data is stored in further segments. This tool does not decode them.',
    group: 'xmp',
    limitations: ['Extended XMP content was not reassembled or itemised.'],
  },

  // ---- IPTC / Photoshop
  'iptc.byline': { category: 'identity', label: 'Creator (IPTC)', privacy: 'Names the person credited with the image.', group: 'iptc' },
  'iptc.credit': { category: 'identity', label: 'Credit or source (IPTC)', privacy: 'Names an organisation or person credited with or supplying the image.', group: 'iptc' },
  'iptc.copyright': { category: 'identity', label: 'Copyright (IPTC)', privacy: 'Copyright text often contains a person or organisation name.', group: 'iptc' },
  'iptc.caption': { category: 'document-properties', label: 'Caption (IPTC)', privacy: 'Free text that can contain names, places or other details.', group: 'iptc' },
  'iptc.headline': { category: 'document-properties', label: 'Headline or title (IPTC)', privacy: 'Descriptive text that can reveal subjects or projects.', group: 'iptc' },
  'iptc.keywords': { category: 'document-properties', label: 'Keywords (IPTC)', privacy: 'Keywords can reveal subjects, places or projects.', group: 'iptc' },
  'iptc.location': { category: 'location', label: 'Place (IPTC)', privacy: 'City, region or country can reveal where an image was taken.', group: 'iptc' },
  'iptc.date': { category: 'time', label: 'Date (IPTC)', privacy: TIME_NOTE, group: 'iptc' },
  'iptc.other': { category: 'document-properties', label: 'Other IPTC fields', privacy: 'Additional descriptive fields that this tool does not itemise.', group: 'iptc' },
  'photoshop.block': {
    category: 'document-properties',
    label: 'Photoshop resource block',
    privacy: 'A container used by Adobe software for IPTC text, thumbnails and other resources.',
    group: 'iptc',
    limitations: ['Resources other than IPTC text and thumbnails are counted but not decoded.'],
  },
  'photoshop.thumbnail': {
    category: 'embedded-content',
    label: 'Photoshop embedded thumbnail',
    privacy: 'A small preview image stored in the metadata. It can show an earlier version of the picture.',
    group: 'iptc',
  },

  // ---- JPEG structure
  'jpeg.comment': {
    category: 'document-properties',
    label: 'JPEG comment',
    privacy: 'Free text stored in the file. Programs sometimes write their name or settings here.',
    group: 'comments',
  },
  'jpeg.jfif': { category: 'structural', label: 'JFIF header', privacy: NOT_PRIVATE, transformation: 'preserved' },
  'jpeg.jfif-thumbnail': {
    category: 'embedded-content',
    label: 'JFIF embedded thumbnail',
    privacy: 'A small preview stored in the file header. It can differ from the main picture.',
    group: 'other-segments',
  },
  'jpeg.adobe': {
    category: 'structural',
    label: 'Adobe color marker',
    privacy: 'Tells decoders how to interpret colour channels. The copy keeps it because removing it can change colours.',
    transformation: 'preserved',
  },
  'jpeg.mpf': {
    category: 'embedded-content',
    label: 'Multi-picture data (MPF)',
    privacy:
      'Some cameras and phones store additional images, previews or depth data in the same file. These extra images may carry their own metadata.',
    group: 'other-segments',
    limitations: ['Additional images referenced by this segment were not extracted or inspected.'],
  },
  'jpeg.app-unknown': {
    category: 'unsupported',
    label: 'Application-specific segment',
    privacy: 'A program stored its own data here. This tool cannot tell what it contains.',
    group: 'other-segments',
    limitations: ['The contents were not decoded. Only the identifier and size are known.'],
  },
  'jpeg.trailing-data': {
    category: 'embedded-content',
    label: 'Data after the end of the image',
    privacy:
      'Bytes follow the JPEG end marker. Viewers ignore them, but they can hold extra content such as another image, an archive, or leftover data from an earlier edit.',
    group: 'trailer',
    limitations: ['The trailing bytes were measured but their meaning was not decoded.'],
  },
  'jpeg.truncated': {
    category: 'structural',
    label: 'JPEG ends unexpectedly',
    privacy: 'The file stops before a proper end marker, so it may be damaged or incomplete.',
  },
  'jpeg.invalid-segment': {
    category: 'structural',
    label: 'Invalid JPEG segment',
    privacy: 'A segment has an impossible length or marker. The rest of the file could not be read reliably.',
  },
  'jpeg.duplicate': {
    category: 'structural',
    label: 'Duplicated JPEG structure',
    privacy: 'The same kind of segment appears more than once where normally only one is expected. Only the first is described.',
  },
  'jpeg.limit': {
    category: 'unsupported',
    label: 'Analysis stopped at a safety limit',
    privacy: 'The file has more structures than this tool is willing to examine, so some content was not inspected.',
  },
  'icc.profile': {
    category: 'device-software',
    label: 'Colour profile (ICC)',
    privacy:
      'Describes how colours should be displayed. It is normally ordinary, but its description can name a device, program or organisation. The experimental copy keeps it so colours stay the same.',
    transformation: 'preserved',
  },

  // ---- PNG
  'png.text': {
    category: 'document-properties',
    label: 'Text entry',
    privacy: 'PNG text entries are free text. Common keys such as Author, Software or Comment can contain names, tools or notes.',
    group: 'png-text',
  },
  'png.text-author': {
    category: 'identity',
    label: 'Author text entry',
    privacy: 'A name stored in the file can identify its creator.',
    group: 'png-text',
  },
  'png.text-software': {
    category: 'device-software',
    label: 'Software text entry',
    privacy: 'Names the program that wrote the file.',
    group: 'png-text',
  },
  'png.text-time': {
    category: 'time',
    label: 'Creation time text entry',
    privacy: TIME_NOTE,
    group: 'png-text',
  },
  'png.time': {
    category: 'time',
    label: 'Last modification time (tIME)',
    privacy: TIME_NOTE,
    group: 'png-time',
  },
  'png.phys': {
    category: 'structural',
    label: 'Physical pixel size (pHYs)',
    privacy: 'Intended print density. It affects display size, not identity, so the copy keeps it.',
    transformation: 'preserved',
  },
  'png.unknown-chunk': {
    category: 'unsupported',
    label: 'Unrecognised chunk',
    privacy: 'The file contains a chunk this tool does not understand. It could be harmless or hold software-specific data.',
    group: 'png-unknown',
    limitations: ['The contents were not decoded. Only the chunk name and size are known.'],
  },
  'png.known-private': {
    category: 'embedded-content',
    label: 'Known software-specific chunk',
    privacy: 'The chunk name is associated with a particular program or standard (the association is inferred from the name only).',
    group: 'png-unknown',
    limitations: ['The contents were not decoded.'],
  },
  'png.crc-invalid': {
    category: 'structural',
    label: 'Chunk checksum does not match',
    privacy: 'A chunk was altered or damaged after it was written. Values in that chunk are less reliable.',
  },
  'png.trailing-data': {
    category: 'embedded-content',
    label: 'Data after IEND',
    privacy:
      'Bytes follow the PNG end chunk. Viewers ignore them, but they can hold extra content such as another file or leftover data.',
    group: 'trailer',
    limitations: ['The trailing bytes were measured but their meaning was not decoded.'],
  },
  'png.truncated': {
    category: 'structural',
    label: 'PNG ends unexpectedly',
    privacy: 'The file stops before its end chunk, or a chunk length runs past the end of the file.',
  },
  'png.invalid': {
    category: 'structural',
    label: 'Invalid PNG structure',
    privacy: 'A required structure is missing or impossible, so the file may not display everywhere.',
  },
  'png.order': {
    category: 'structural',
    label: 'Unusual chunk order or duplication',
    privacy: 'The PNG specification requires a particular order. Viewers may react differently to files that break it.',
  },
  'png.apng': {
    category: 'structural',
    label: 'Animated PNG',
    privacy: 'The file contains animation frames. The copy preserves them as they are, but this tool previews only the default image.',
    transformation: 'preserved',
  },
  'png.limit': {
    category: 'unsupported',
    label: 'Analysis stopped at a safety limit',
    privacy: 'The file has more structures than this tool is willing to examine, so some content was not inspected.',
  },
  'png.render-chunk': {
    category: 'structural',
    label: 'Colour and display chunk',
    privacy: NOT_PRIVATE,
    transformation: 'preserved',
  },

  // ---- PDF
  'pdf.version': { category: 'document-properties', label: 'PDF version', privacy: NOT_PRIVATE },
  'pdf.pages': { category: 'structural', label: 'Page count', privacy: NOT_PRIVATE },
  'pdf.title': { category: 'document-properties', label: 'Title', privacy: 'A title can describe the content or reveal a project name.' },
  'pdf.author': { category: 'identity', label: 'Author', privacy: 'A name stored in the file can identify its creator, and often comes from the account name of the program used.' },
  'pdf.subject': { category: 'document-properties', label: 'Subject', privacy: 'Free text that can describe the content.' },
  'pdf.keywords': { category: 'document-properties', label: 'Keywords', privacy: 'Keywords can reveal subjects or projects.' },
  'pdf.creator': { category: 'device-software', label: 'Creator application', privacy: 'Names the program that created the original document.' },
  'pdf.producer': { category: 'device-software', label: 'Producer', privacy: 'Names the program that produced the PDF. Common and rarely sensitive.' },
  'pdf.created': { category: 'time', label: 'Creation date', privacy: TIME_NOTE },
  'pdf.modified': { category: 'time', label: 'Modification date', privacy: TIME_NOTE },
  'pdf.xmp': {
    category: 'document-properties',
    label: 'XMP metadata packet',
    privacy: 'XMP can carry authors, tools, history and identifiers in addition to the Info dictionary.',
    limitations: ['Only well-known XMP properties are itemised.'],
  },
  'pdf.document-id': {
    category: 'identity',
    label: 'Document ID',
    privacy: 'The file identifier can link copies and versions of the same document.',
  },
  'pdf.attachments': {
    category: 'embedded-content',
    label: 'Embedded files',
    privacy: 'Files can be attached inside a PDF and may not be visible on the page. Their names and contents were not opened.',
    limitations: ['Attachment contents were not extracted or inspected.'],
  },
  'pdf.annotations': {
    category: 'embedded-content',
    label: 'Annotations',
    privacy: 'Comments, highlights and notes may carry author names and dates, and some are not obvious on the page.',
  },
  'pdf.annotation-author': {
    category: 'identity',
    label: 'Annotation author',
    privacy: 'Annotations often record the name of the person who wrote them.',
  },
  'pdf.forms': {
    category: 'embedded-content',
    label: 'Form fields',
    privacy: 'Form fields can hold typed values or defaults that are not obvious on the page.',
  },
  'pdf.javascript': {
    category: 'active-features',
    label: 'JavaScript or scripted action',
    privacy:
      'The PDF contains scripts or actions that some viewers can run. This tool never runs them. Presence is not evidence of harm.',
    limitations: ['Script contents were not analysed or executed.'],
  },
  'pdf.actions': {
    category: 'active-features',
    label: 'Automatic or link actions',
    privacy: 'Actions can open links, launch other files or submit data when something is clicked or when the document opens. This tool follows none of them.',
    limitations: ['Targets were not resolved or followed.'],
  },
  'pdf.encrypted': {
    category: 'unsupported',
    label: 'Encrypted document',
    privacy: 'The file is encrypted, so its metadata and contents were not read. This tool does not try passwords.',
  },
  'pdf.signature': {
    category: 'identity',
    label: 'Digital signature',
    privacy: 'A signature can identify the signer and a signing time. Its validity was not checked.',
    limitations: ['Signature validity and certificates were not verified.'],
  },
  'pdf.incremental': {
    category: 'structural',
    label: 'Incremental updates',
    privacy:
      'Edits saved incrementally keep earlier content in the file. Previous versions of text or metadata may still be present.',
    limitations: ['Earlier revisions were counted from end-of-file markers but not reconstructed.'],
  },
  'pdf.truncated': {
    category: 'structural',
    label: 'PDF ends unexpectedly',
    privacy: 'The file lacks a proper end marker or cross-reference data, so it may be damaged.',
  },
  'pdf.malformed': {
    category: 'structural',
    label: 'PDF could not be fully parsed',
    privacy: 'The reviewed PDF library reported an error. Values below come from a raw scan and are less certain.',
  },
  'pdf.raw-token': {
    category: 'structural',
    label: 'Raw structure scan',
    privacy: 'A scan of the raw bytes found names associated with a feature. This is an indicator, not a parsed result.',
  },
  'pdf.limit': {
    category: 'unsupported',
    label: 'Analysis stopped at a safety limit',
    privacy: 'The document is larger than this tool is willing to examine fully, so some content was not inspected.',
  },
  'pdf.custom': {
    category: 'document-properties',
    label: 'Custom properties',
    privacy: 'Programs sometimes store extra named properties, such as project names or internal identifiers, in the Info dictionary.',
  },
  'pdf.layers': {
    category: 'embedded-content',
    label: 'Layers (optional content)',
    privacy: 'Layers can be switched off by default, so some content may exist in the file without being visible on the page.',
    limitations: ['Content of hidden layers was not examined.'],
  },
  'pdf.hidden-text': {
    category: 'unsupported',
    label: 'Page content not inspected',
    privacy: 'The tool does not read page content, so it cannot say whether text or images on pages reveal anything.',
  },
};
