# TECHNICAL FLOW MATRIX — E-commerce platform — infrastructure view

| No. | Source | Destination | Protocol | Port | Flow |
|---|---|---|---|---|---|
| 1 | Internet customers | Application firewall (WAF) (DMZ) | HTTPS | 443 |  |
| 2 | Application firewall (WAF) (DMZ) | Nginx (DMZ) | HTTPS | 443 |  |
| 3 | Nginx (DMZ) | Gateway (Application zone) | HTTPS | 443 |  |
| 4 | Gateway (Application zone) | OAuth2 proxy (Application zone) | HTTPS | 8443 |  |
| 5 | OAuth2 proxy (Application zone) | LDAP / IdP (Application zone) | LDAPS | 636 |  |
| 6 | Gateway (Application zone) | Sales front (Application zone) | HTTPS | 8443 |  |
| 7 | Gateway (Application zone) | Checkout funnel (Application zone) | HTTPS | 8444 |  |
| 8 | Sales front (Application zone) | Order management (Application zone) | HTTPS | 8443 |  |
| 9 | Checkout funnel (Application zone) | Payment hub (Application zone) | HTTPS | 8445 |  |
| 10 | Payment hub (Application zone) | PSP | HTTPS | 443 |  |
| 11 | Order management (Application zone) | PostgreSQL primary (Data zone) | TCP | 5432 |  |
| 12 | Payment hub (Application zone) | PostgreSQL primary (Data zone) | TCP | 5432 |  |
| 13 | Order management (Application zone) | Kafka (Data zone) | TCP | 9092 |  |
| 14 | Sales front (Application zone) | Kafka (Data zone) | TCP | 9092 |  |
| 15 | Order management (Application zone) | Transfer gateway (DMZ) | SFTP | 22 |  |
| 16 | Transfer gateway (DMZ) | Carrier platforms | AS4 | 443 |  |
| 17 | PostgreSQL primary (Data zone) | PostgreSQL replica (DR data zone) | TCP | 5432 |  |
| 18 | PostgreSQL standby (DR data zone) | Backup server (DR data zone) | TCP | 9095 |  |
| 19 | Kafka (Data zone) | Backup server (DR data zone) | TCP | 9095 |  |
