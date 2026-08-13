# Release gate

| Item | Status | Release condition |
|---|---|---|
| LumiField independent five-tile spotlight | `NOT_BLOCKED_BY_UPSTREAM_LICENSE` | Preserve the independent implementation and provenance record. |
| Copy/adaptation of the supplied or live 21st.dev component expression | `LICENSE_BLOCKED_UPSTREAM_COPY` | Obtain and retain an exact source identity plus a license or written grant compatible with intended distribution before importing upstream expression. |
| User-supplied image/TXT/video | `REFERENCE_ONLY_NOT_PACKAGED` | Keep them out of runtime and release packages unless separate redistribution rights are confirmed. |

The upstream-copy gate does not stop private development, testing, or release
of LumiField's independently authored replacement.
