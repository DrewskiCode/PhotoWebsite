// All of the gallery's words live here: photo titles, wall text, films, awards.
// Edit freely — nothing in this file affects the building's geometry.

export const SITE = {
  name: 'Drewski Photos',
  tagline: 'Sports photography from Southern California',
  sub: 'Track, cross country and grad sessions by Drew Floyd, with a passion for creating colorful images',
  email: 'andrew.christopher.floyd@gmail.com',
  instagram: 'https://www.instagram.com/drewski.photo/',
  youtube: 'https://www.youtube.com/@drewfilm',
  formspree: 'https://formspree.io/f/xlgpovvp',
};

// Rooms in lap order. `id` matches the room ids baked into layout.json.
export const ROOMS = [
  { id: 'atrium', title: 'Entrance' },
  { id: 'track', title: 'On your marks', note: 'Track and field, from the blocks to the line' },
  { id: 'rotunda', title: 'The moment', note: 'Four frames that only happened once' },
  { id: 'north', title: 'After the line', note: 'What a race leaves behind' },
  { id: 'dark', title: 'After hours', note: 'Off the clock, after dark' },
  { id: 'grads', title: 'Class of', note: 'Grad sessions for previous clients' },
  { id: 'screening', title: 'Motion pictures', note: 'Short films and documentaries' },
  { id: 'awards', title: 'Accolades', note: 'Recognised across photography and short film' },
  { id: 'court', title: 'The infield' },
];

// Photo titles. The six that came with names keep them; the rest are working
// titles — rename them here.
export const PHOTOS = {
  'dsc00763': { title: 'On Your Marks', series: 'Track & Field' },
  'dsc00858': { title: 'Set', series: 'Track & Field' },
  'dsc00847': { title: 'The Board', series: 'Track & Field' },
  'dsc04620': { title: 'Drive Phase', series: 'Track & Field' },
  'dsc02454': { title: 'Before the Gun', series: 'Track & Field' },
  'nocompetition': { title: 'No Competition', series: 'Track & Field' },
  'dsc00968': { title: 'Clearance', series: 'Track & Field' },
  'relayanchor': { title: 'Relay Anchor', series: 'Track & Field' },
  'dsc01327-2': { title: 'Empty Tank', series: 'Track & Field' },
  'dsc00626-2': { title: 'Hang Time', series: 'Track & Field' },
  'dsc07721': { title: '197', series: 'Cross Country' },
  'dsc06236': { title: 'Aftermath', series: 'Cross Country' },
  'dsc05438': { title: 'The Gun', series: 'Cross Country' },
  'dsc07728': { title: 'Salt', series: 'Portrait' },
  'dsc01498': { title: 'Good Race', series: 'Track & Field' },
  'dsc02884': { title: 'Teammates', series: 'Portrait' },
  'dsc03287': { title: 'Vaulter', series: 'Track & Field' },
  'goldenboy': { title: 'Golden Boy', series: 'After Hours' },
  'finale': { title: 'Finale', series: 'After Hours' },
  'starfield': { title: 'Starfield', series: 'After Hours' },
  'hunt': { title: 'Hunt', series: 'After Hours' },
  'bri1': { title: 'Bri, No. 1', series: 'University of San Diego' },
  'bri2': { title: 'Bri, No. 2', series: 'University of San Diego' },
  'bri3': { title: 'Bri, No. 3', series: 'University of San Diego' },
  'bri4': { title: 'Bri, No. 4', series: 'University of San Diego' },
  'bri5': { title: 'Bri, No. 5', series: 'University of San Diego' },
  'jesse1': { title: 'Jesse, No. 1', series: 'Chapman University' },
  'jesse2': { title: 'Jesse, No. 2', series: 'Chapman University' },
  'jesse3': { title: 'Jesse, No. 3', series: 'Chapman University' },
  'jesse4': { title: 'Jesse, No. 4', series: 'Chapman University' },
  'jesse5': { title: 'Jesse, No. 5', series: 'Chapman University' },
  'jesse6': { title: 'Jesse, No. 6', series: 'Chapman University' },
  'jesse7': { title: 'Jesse, No. 7', series: 'Chapman University' },
  'jesse8': { title: 'Jesse, No. 8', series: 'Chapman University' },
  'start3': { title: 'Drew Floyd', series: 'The photographer' },
};

export const FILMS = [
  { id: 'film1', yt: 'cxO2Woo5jsY', title: 'Brenda Daza, Chasing Nationals', kind: 'Short Documentary' },
  { id: 'film2', yt: 'kj1dcf7hXOc', title: '"FI"tted', kind: 'A Comedy Short Film' },
  { id: 'film3', yt: 'OF0e2FxdvkQ', title: 'Here and Hungry', kind: 'Cross Country Short Documentary' },
  { id: 'film4', yt: 'yaRC_c88i8g', title: 'GETAWAY', kind: 'A 48 Hour Film Project 2024' },
];

export const AWARDS = [
  ['2025', 'B&H Edu Sports Photography Contest', '1st Place'],
  ['2025', 'B&H Edu Back to School Contest', '1st Place'],
  ['2025', 'ReelShort FilmFest', 'Top 10 Student Film, Top 50 Suspense Film'],
  ['2024', 'Los Angeles Student Film Awards', 'Finalist in Documentary Category for "Here and Hungry"'],
  ['2023', 'San Diego Fair', 'Best in Class News Segment, Best in Show for Short Film'],
  ['2022', 'SweetTarts FilmFest', 'Winner for Best Expression of #BeBoth'],
  ['2022', 'NCHS 48 Hour Film Festival', 'Winning Film'],
  ['2022', 'NCHS Spring Film Festival', 'Winning Film'],
  ['2022', 'San Diego (Del Mar) Fair', 'Best in Class News Segment'],
  ['2022', 'San Diego (Del Mar) Fair', 'Best in Show for Documentary'],
  ['2022–Pres.', '48 Hour Film Project', 'Multiple Awards: Best Music, Best Ensemble Cast, Rising Star Actor Awards, Best VFX'],
];

export const ABOUT = {
  name: 'Drew Floyd',
  bio: 'I specialize in sports photography and videography, with experience shooting fast-paced athletic events and structured media day content. My work emphasizes timing, composition, and motion capture, particularly in track and field environments. I use Adobe Lightroom for photo editing and Final Cut Pro for video production, managing color correction, sequencing, and final delivery. I focus on creating content that is both visually strong and story-driven.',
  quote: 'Become Undeniable',
  quoteBy: 'Adam Scott',
  capabilities: [
    'Sports Photography & Videography',
    'Chapman University Athletics Coverage',
    'Lightroom Color Grading & Visuals',
    'Final Cut Pro Video Editing & Sequencing',
  ],
};

export const CONTACT = {
  head: "Let's get to work",
  sub: "I'm a photographer and videographer with a focus on sports and storytelling. Reach out to discuss availability, rates, and your next shoot.",
};
