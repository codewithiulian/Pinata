import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: { document: "/" },
  workboxOptions: {
    additionalManifestEntries: [
      { url: "/icons/logo.png", revision: "1" },
      { url: "/icons/app-logo.png", revision: "1" },
      { url: "/images/Carolina.png", revision: "1" },
      { url: "/pdfjs/web/viewer.html", revision: "1" },
      { url: "/pdfjs/web/viewer.mjs", revision: "1" },
      { url: "/pdfjs/web/viewer.css", revision: "1" },
      { url: "/pdfjs/build/pdf.mjs", revision: "1" },
      { url: "/pdfjs/build/pdf.worker.mjs", revision: "1" },
      { url: "/pdfjs/build/pdf.sandbox.mjs", revision: "1" },
    ],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-css",
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-webfonts",
          expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: /\/_next\/image\?.*/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "next-image",
          expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-images",
          expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: /\/api\/quizzes.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-quizzes",
          expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
          networkTimeoutSeconds: 5,
        },
      },
      {
        urlPattern: /\/api\/lessons.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-lessons",
          expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
          networkTimeoutSeconds: 5,
        },
      },
      {
        urlPattern: /\/api\/weeks.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-weeks",
          expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 7 },
          networkTimeoutSeconds: 5,
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  devIndicators: false,
};

export default withPWA(nextConfig);
