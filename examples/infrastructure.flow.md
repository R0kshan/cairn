# TECHNICAL FLOW MATRIX — Billing platform — infrastructure view

| No. | Source | Destination | Protocol | Port | Flow |
|---|---|---|---|---|---|
| 1 | User workstations | WAF (DMZ) | HTTPS | 443 |  |
| 2 | WAF (DMZ) | Gateway (Application zone) | HTTPS | 443 |  |
| 3 | Gateway (Application zone) | OAuth2 proxy (Application zone) | HTTP | 80 |  |
| 4 | OAuth2 proxy (Application zone) | LDAP / IdP (Application zone) | LDAPS | 636 |  |
| 5 | Gateway (Application zone) | Billing (Application zone) | HTTPS | 8443 |  |
| 6 | Gateway (Application zone) | CRM (Application zone) | HTTPS | 8444 |  |
| 7 | Billing (Application zone) | PostgreSQL (Data zone) | TCP | 5432 |  |
| 8 | CRM (Application zone) | PostgreSQL (Data zone) | TCP | 5432 |  |
| 9 | Billing (Application zone) | Message broker (Application zone) | TCP | 9092 |  |
| 10 | Message broker (Application zone) | CRM (Application zone) | TCP | 9092 |  |
| 11 | Billing (Application zone) | Transfer gateway (DMZ) | SFTP | 22 |  |
| 12 | Transfer gateway (DMZ) | Partner EDI platform | AS4 | 443 |  |
| 13 | Database server (Data zone) | Backup server (Data zone) | TCP | 9092 |  |
