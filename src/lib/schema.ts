// schema.org JSON-LD for search engines. One Person node, referenced by @id from every post,
// so the homepage and each article resolve to the same author entity.

const SITE = 'https://amaanx86.github.io';

export const PERSON_ID = `${SITE}/#person`;
export const WEBSITE_ID = `${SITE}/#website`;

export const person = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Amaan Ul Haq Siddiqui',
  url: `${SITE}/`,
  jobTitle: 'DevOps & Cloud Security Engineer',
  worksFor: {
    '@type': 'Organization',
    name: 'SUDO Consultants',
    url: 'https://sudoconsultants.com',
  },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Karachi',
    addressCountry: 'PK',
  },
  identifier: {
    '@type': 'PropertyValue',
    propertyID: 'ORCID',
    value: '0009-0003-4839-9727',
  },
  sameAs: [
    'https://orcid.org/0009-0003-4839-9727',
    'https://github.com/amaanx86',
    'https://gitlab.com/amaanx86',
    'https://www.linkedin.com/in/amaanulhaqsiddiqui/',
    'https://www.credly.com/users/amaanx86',
  ],
};

export const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: `${SITE}/`,
  name: "Amaan's Engineering Notes",
  inLanguage: 'en',
  publisher: { '@id': PERSON_ID },
};

export const homeGraph = {
  '@context': 'https://schema.org',
  '@graph': [person, website],
};

interface PostInput {
  title: string;
  description: string;
  date: Date;
  tags: string[];
  url: string;
  image: string;
}

export const blogPosting = ({ title, description, date, tags, url, image }: PostInput) => ({
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: title,
  description,
  datePublished: date.toISOString(),
  dateModified: date.toISOString(),
  url,
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  image,
  keywords: tags.join(', '),
  inLanguage: 'en',
  // Repeat name and url so the article stands alone if a crawler never reads the homepage.
  author: { '@type': 'Person', '@id': PERSON_ID, name: person.name, url: person.url },
  publisher: { '@type': 'Person', '@id': PERSON_ID, name: person.name, url: person.url },
  isPartOf: { '@id': WEBSITE_ID },
});

// JSON.stringify does not escape "<", so a title containing "</script>" could close the tag early.
export const toJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
