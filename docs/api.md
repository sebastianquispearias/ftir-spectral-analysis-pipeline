# API Reference

Base URL: `http://localhost:8000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Upload .dpt files (multipart) |
| GET | `/api/files` | List uploaded files |
| DELETE | `/api/files/{file_id}` | Delete a file |
| GET | `/api/spectrum/{file_id}` | Get spectrum data (x, y arrays) |
| POST | `/api/baseline/preview` | Preview baseline with anchor points |
| POST | `/api/process` | Process all files with anchor points |
| GET | `/api/results` | Get processed results |
| POST | `/api/anova` | Run ANOVA analysis |
| GET | `/api/export/excel` | Download Excel report |

## Session Management

Sessions are identified by a `session_id` cookie (set automatically on first upload). Sessions expire after 1 hour of inactivity.
