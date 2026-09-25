export default function ProductLoading() {
  return (
    <div className="page-stack loading-page" aria-busy="true" role="status" aria-live="polite">
      <span className="sr-only">Loading workspace content…</span>
      <div className="loading-line short" aria-hidden="true" />
      <div className="loading-line title" aria-hidden="true" />
      <div className="loading-line medium" aria-hidden="true" />
      <div className="loading-card-grid" aria-hidden="true"><div /><div /><div /><div /></div>
      <div className="loading-panel" aria-hidden="true" />
    </div>
  );
}
