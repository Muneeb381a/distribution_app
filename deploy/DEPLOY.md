# Deploy karne ki hidayat (server par chalana)

Ye files poora system (database, API, website) ek hi server par Docker mein chalati hain.
Do raaste hain, dono ke liye files wahi hain:

- **Raasta 1: Oracle Cloud ki muft VM** (public IP + apna domain, HTTPS Caddy khud laga deta hai).
- **Raasta 2: dukaan ka apna PC / laptop + Cloudflare Tunnel** (koi port kholne ki zaroorat nahi).

> **Pehle samajh lein:** server kharab ho ya band kar diya jaye to data bhi jata hai. Is liye "Backup ki dusri copy"
> (neeche) ka hissa zaroor karein. Oracle ka muft account bina wajah bataye band hone ki shikayaten aam hain.

---

## 0. Kya kya chahiye

- Ek server: Linux (Ubuntu 22.04 ya 24.04), kam az kam 1 core aur 4 GB RAM. Oracle ki muft VM (2 core / 12 GB) bohot kaafi hai.
- **Docker** aur **git** server par.
- Do naam jo server ki taraf jayen, jaise `app.dukaan.pk` (website) aur `api.dukaan.pk` (API). Domain nahi hai to Cloudflare Tunnel wala raasta ya muft naam (DuckDNS) istemal karein.
- Pehli baar build ke waqt internet chahiye (Google Fonts download hote hain).

## 1. Server taiyar karna

### Raasta 1: Oracle Cloud

1. cloud.oracle.com par muft account banayen (asli Visa/Mastercard chahiye, international payment on ho).
2. **Compute → Instances → Create**: image **Ubuntu 22.04**, shape **VM.Standard.A1.Flex**, **2 OCPU / 12 GB** se zyada mat lein (muft hadd). SSH key download kar lein.
3. Network ki **Security List / NSG** mein **80** aur **443** (TCP, source 0.0.0.0/0) kholein. 22 pehle se khula hota hai.
4. VM ke andar bhi firewall kholein:
   ```bash
   sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
5. Domain ke DNS mein do **A record** banayen: `app` aur `api`, dono VM ke public IP par.

### Raasta 2: Apna PC / laptop

1. Ubuntu server ya Windows par Docker Desktop chalayein. PC hamesha on aur internet se judaa rahe.
2. dash.cloudflare.com (muft) par domain add karein, phir **Zero Trust → Networks → Tunnels → Create tunnel**. Tunnel ka **token** copy kar lein.
3. Tunnel ke **Public hostname** mein do entries banayen:
   - `app.dukaan.pk` → `http://web:3100`
   - `api.dukaan.pk` → `http://api:3010`

## 2. Docker aur code lagana

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # phir logout / login
git clone <aap-ki-repo-ka-address> distribution_app
cd distribution_app
```

## 3. Settings bharna

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Bharna hai:

| Naam | Kya likhna hai |
|---|---|
| `DB_PASSWORD` | lambi, sirf harf aur ginti. Banayen: `openssl rand -hex 24` |
| `JWT_SECRET` | lambi rakhi hui: `openssl rand -hex 32` |
| `WEB_HOST`, `API_HOST` | `app.dukaan.pk`, `api.dukaan.pk` |
| `WEB_ORIGIN` | `https://app.dukaan.pk` |
| `PUBLIC_API_URL` | `https://api.dukaan.pk` |
| `TUNNEL_TOKEN` | sirf Cloudflare Tunnel ke liye |

**`PUBLIC_API_URL` website ke build ke waqt andar baith jata hai.** Ise baad mein badlein to dobara build karna padega.

## 4. Chalana

```bash
# Oracle / apna IP (HTTPS khud):
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile caddy up -d --build

# Cloudflare Tunnel:
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env --profile tunnel up -d --build
```

Pehli baar 5-15 minute lagte hain (Oracle ki ARM VM par thoda zyada). Dekhne ke liye:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f api
```

## 5. Pehla owner user banana

Database khali hota hai. Ek baar chalayein (password apna chunein):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec -e SEED_OWNER_PASSWORD='koi-lamba-password' api pnpm db:seed
```

Is se user `owner`, roles, default locations aur categories ban jati hain. `SEED_OWNER_PASSWORD` na dein to ek random password
screen par aata hai (sirf ek baar). Phir `https://app.dukaan.pk` kholein, `owner` se login karein aur **Settings** mein dukaan ka naam bharein.

> Ye seed dobara chalane se kuch nahi bigarta (jo hai wo wahin rehta hai).

## 6. Backup (bohot zaroori)

App khud roz backup leti hai (jab pichla 24 ghante se purana ho). Ye `backups/` folder mein jama hote hain aur
**Settings → Backup** se dekhe ya download kiye ja sakte hain. Lekin wo usi server par hain.

### Backup ki dusri copy (rclone se Google Drive)

1. Server par: `sudo apt-get install -y rclone`.
2. Apne PC par rclone chala kar `rclone authorize "drive"` karein, jo browser kholega aur ek lamba token dega.
3. Server par `rclone config` chalayein: naya remote, naam `gdrive`, type `drive`, aur wahi token paste karein.
4. Check: `rclone lsd gdrive:`
5. Roz raat ko apne aap copy ke liye cron:
   ```bash
   crontab -e
   30 2 * * *  /home/ubuntu/distribution_app/deploy/offsite-backup.sh >> /var/log/dist-offsite.log 2>&1
   ```
   (path apni jagah ka likhein). Ye script sirf nai files copy karti hai, Drive se kuch delete nahi karti.

Ek maheene mein ek baar **Settings → Backup** se koi backup download kar ke apne PC par bhi rakhein.

### Backup se wapas aana (restore)

Naye server par upar ke qadam 2 se 4 karein, database khali chalne dein, phir API ko rok kar:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env stop api
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec -T db \
  pg_restore -U dist -d distribution --clean --if-exists --no-owner < backups/distribution-2026-11-08_2320.dump
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env start api
```

(Is se mojooda data badal jata hai. Pehle kisi test server par aazma lein.)

## 7. Update karna (naya code lagana)

```bash
bash deploy/update.sh caddy        # ya: tunnel
```

Ye pehle backup leta hai, code `git pull` karta hai, dobara build kar ke chalata hai. Database ki naye tabdiliyan (migrations)
API ke start hote hi khud lag jati hain.

## 8. Hifazat ki fehrist

- [ ] `owner` ka password lamba aur alag hai, aur **Settings → My profile** mein badal diya.
- [ ] `deploy/.env` kisi ke saath share nahi hua aur git mein nahi gaya (`.gitignore` mein hai).
- [ ] Database ka port bahar nahi khula (ye files use bahar nahi kholtin).
- [ ] Backup ki dusri copy roz ja rahi hai (upar rclone).
- [ ] Server ke packages kabhi kabhi update: `sudo apt-get update && sudo apt-get upgrade`.
- [ ] Kam staff ko wahi permissions jo unhein chahiye (Users & roles).

## 9. Masle aur hal

| Masla | Dekhein |
|---|---|
| Website khulti hai magar login "network error" | `PUBLIC_API_URL` galat tha. Sahi karke dobara `up -d --build`. |
| Login ke baad CORS ka error | `WEB_ORIGIN` bilkul website ke address jaisa (https ke saath) hona chahiye. |
| `502 Bad Gateway` | API abhi start ho rahi hai. `logs api` dekhein. |
| HTTPS ka certificate nahi aaya | DNS ke A records server ke IP par hain? Port 80 aur 443 khule hain? |
| Build bohot dheema ya "killed" | RAM kam hai. 2 GB ka swap file lagayein ya bari VM lein. |
| Fonts download ka error build mein | Server par internet check karein, dobara try. |

Logs dekhna: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs --tail 100 api`
