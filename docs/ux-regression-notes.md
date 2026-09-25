# UX regression boundaries

Future product changes should preserve the shared #37 contracts rather than reintroducing page-local one-off behavior. New destructive or terminal buttons must either match the shared confirmation policy or explicitly adopt `ConfirmDialog`. New tables inside `#main-content` must use semantic table markup so the runtime can label mobile cards. New modal surfaces should use `ModalSurface` so focus trapping and restoration are deterministic.
