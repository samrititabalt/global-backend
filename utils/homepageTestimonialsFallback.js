/**
 * Static fallback testimonials for GET /api/public/testimonials when MongoDB is empty/unavailable.
 * Keep in semantic sync with frontend: global-frontend/src/data/homepageTestimonialsFallback.js
 */
const HOMEPAGE_TESTIMONIALS_FALLBACK = [
  {
    id: 'fb-1',
    quote: 'Had a Salesforce dev productive within days. Pilot felt low-risk and well run.',
    name: 'Sarah Lin',
    role: 'Director of Salesforce',
    company: 'UK professional services firm',
    imageUrl:
      'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Salesforce Developer', '7-Day Pilot'],
  },
  {
    id: 'fb-2',
    quote: 'Tableau dashboards finally matched how our executives read the numbers. Solid delivery.',
    name: 'Marcus Reid',
    role: 'Analytics Lead',
    company: 'Mid-market SaaS company',
    imageUrl:
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Data Team'],
  },
  {
    id: 'fb-3',
    quote: 'Offshore model without the chaos—clear rituals and someone owning quality onshore.',
    name: 'Elena Okonkwo',
    role: 'Head of BI',
    company: 'Financial services scale-up',
    imageUrl:
      'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Power BI Developer', '7-Day Pilot'],
  },
  {
    id: 'fb-4',
    quote: 'Data engineer slotted into our backlog like an internal hire. Good communication.',
    name: 'Tom Hughes',
    role: 'Engineering Manager',
    company: 'B2B software vendor',
    imageUrl:
      'https://images.unsplash.com/photo-1519085360753-af01190fccf7?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Data Team'],
  },
  {
    id: 'fb-5',
    quote: 'Two-week pilot answered every concern. Extended without drama.',
    name: 'Priya Desai',
    role: 'CTO',
    company: 'Health tech SME',
    imageUrl:
      'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['7-Day Pilot'],
  },
  {
    id: 'fb-6',
    quote: 'Power BI modelling was cleaner than our last consultancy cycle—faster iteration too.',
    name: 'Chris Porter',
    role: 'Sales Operations Director',
    company: 'Industrial distribution group',
    imageUrl:
      'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Data Team'],
  },
  {
    id: 'fb-7',
    quote: 'Integration work on Salesforce was pragmatic—fewer surprises in stand-ups.',
    name: 'Hannah Byrne',
    role: 'Product Owner',
    company: 'InsurTech team',
    imageUrl:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Salesforce Developer'],
  },
  {
    id: 'fb-8',
    quote: 'We needed capacity yesterday. They scoped honestly and staffed without overselling.',
    name: 'Daniel Frost',
    role: 'VP Data',
    company: 'Retail analytics provider',
    imageUrl:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Data Team', '7-Day Pilot'],
  },
  {
    id: 'fb-9',
    quote: 'Tableau developer understood governance—not just pretty charts. Rare find.',
    name: 'Amira Farouk',
    role: 'BI Manager',
    company: 'Logistics technology company',
    imageUrl:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Data Team'],
  },
  {
    id: 'fb-10',
    quote: 'Clear UK point of contact, India squad that delivered. Exactly what we were missing.',
    name: 'Oliver Grant',
    role: 'IT Director',
    company: 'Private equity-backed services business',
    imageUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=112&h=112&q=80',
    tags: ['Salesforce Developer'],
  },
];

module.exports = { HOMEPAGE_TESTIMONIALS_FALLBACK };
