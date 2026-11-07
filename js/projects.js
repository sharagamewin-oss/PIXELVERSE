// Temporary hardcoded projects (Phase 1).
// In Phase 5 this data will come from Firebase Firestore instead.

export const PROJECTS = [
  {
    id: 'aurora-interfaces',
    title: 'Aurora Interfaces',
    creator: 'Maya Raghavan',
    category: 'UI / UX Design',
    description:
      'A design system and mobile app concept for a meditation platform. The interface uses soft gradients, ' +
      'gentle motion and generous spacing to keep the experience calm, accessible and distraction-free.',
    technologies: ['Figma', 'Design Systems', 'Prototyping', 'Accessibility'],
    link: 'https://example.com/aurora',
    date: '2026-03-14',
    accent: '#7a5c8e'
  },
  {
    id: 'solarsense',
    title: 'SolarSense',
    creator: 'Arjun Mehta',
    category: 'Engineering / IoT',
    description:
      'A low-cost smart monitoring kit for rooftop solar panels. Sensors track output, temperature and dust ' +
      'build-up, then send alerts when cleaning or maintenance is needed. Built as a final-year college project.',
    technologies: ['ESP32', 'C++', 'MQTT', 'Python', 'Data Visualisation'],
    link: 'https://example.com/solarsense',
    date: '2026-04-02',
    accent: '#c47f2c'
  },
  {
    id: 'echoes-of-marina',
    title: 'Echoes of Marina',
    creator: 'Lena Hoffmann',
    category: 'Digital Art',
    description:
      'A series of generative illustrations inspired by the Chennai coastline at dawn. Each piece is produced ' +
      'by a custom algorithm, then painted over by hand to blend code with craft.',
    technologies: ['p5.js', 'Procreate', 'Generative Art', 'Colour Theory'],
    link: '',
    date: '2026-05-21',
    accent: '#2f7f86'
  }
];
