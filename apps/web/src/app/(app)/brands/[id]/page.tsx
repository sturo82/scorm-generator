import { BrandDetailClient } from './brand-detail-client';

// Export statico: shell segnaposto; gli ID reali sono serviti da CloudFront
// (fallback alla shell) e risolti dal client via API.
export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

export const dynamicParams = false;

export default function BrandDetailPage() {
  return <BrandDetailClient />;
}
