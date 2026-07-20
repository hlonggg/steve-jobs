# CoinVault — Telegram Mini App (Task-to-Cash, Admin-Guaranteed Margin)

Nền tảng nhiệm vụ xem quảng cáo trả thưởng, cơ chế: **user xem quảng cáo → admin
nhận tiền từ mạng quảng cáo → hệ thống tự trả user một phần (mặc định 50%) →
admin luôn giữ phần còn lại**. Margin admin không bao giờ âm vì mọi phép chia đều
lấy `sourceRevenue` (số tiền admin thực nhận từ network) làm gốc — xem
`src/lib/economics.js`.

## Cấu trúc
```
prisma/schema.prisma   # data model
src/server.js          # Express app entry (API + serves mini app + starts bot)
src/bot.js             # Telegraf bot (/start, /wallet, /invite)
src/lib/economics.js   # ⭐ toàn bộ công thức chia tiền — đọc file này đầu tiên
src/routes/            # auth, dashboard, tasks, wallet, admin
public/index.html      # Mini App chính (Dashboard / Nhiệm vụ / Ví / VIP)
public/admin.html       # Admin panel (mở qua /admin.html, chỉ ADMIN_TELEGRAM_IDS được vào)
```

## Chạy local trên Termux
```bash
pkg install nodejs-lts
npm install
cp .env.example .env   # điền BOT_TOKEN, DATABASE_URL...
# Nếu chưa có Postgres, đổi provider trong prisma/schema.prisma thành "sqlite"
# và DATABASE_URL="file:./dev.db"
npx prisma generate
npx prisma migrate dev --name init
npm run seed            # tạo nhiệm vụ mẫu + config mặc định
npm run dev
```

## Deploy Railway
1. Push repo lên GitHub, tạo project mới trên Railway từ repo đó.
2. Add plugin **PostgreSQL** — Railway tự set `DATABASE_URL`.
3. Add các biến môi trường còn lại (`BOT_TOKEN`, `MINI_APP_URL`, `ADMIN_TELEGRAM_IDS`).
4. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
   Start command: `npm start`
5. Sau khi deploy xong, lấy domain Railway cấp, set làm `MINI_APP_URL`, và set
   Menu Button / Web App URL trong BotFather (`/setmenubutton`) trỏ về domain đó.
6. Trang admin: `https://<domain>/admin.html` — có 2 lớp chặn:
   - **Mật khẩu** (mặc định `longdzvcl12@`, đổi ở dòng `ADMIN_PANEL_PASSWORD`
     trong `public/admin.html`). ⚠️ Đây chỉ là lớp chặn giao diện, ai xem mã
     nguồn trang cũng đọc được mật khẩu — không dùng để bảo vệ dữ liệu nhạy cảm.
   - **Telegram ID** (`ADMIN_TELEGRAM_IDS` trong `.env`) — đây mới là lớp bảo
     mật thật sự, mọi request admin đều bị backend chặn nếu Telegram ID không
     nằm trong danh sách này, kể cả khi ai đó đoán đúng mật khẩu.

## Adsterra và các network đưa &lt;script&gt; nhúng thẳng (không có callback xác nhận xem xong)

Monetag/Adsgram/Adexium ở trên đều có hàm gọi + callback `onReward` — biết chắc
user xem xong mới trả tiền, nên gắn được vào **nhiệm vụ trả thưởng**. Adsterra
(và phần lớn network dạng Popunder/Social Bar/Banner) thì khác: họ chỉ đưa một
đoạn `<script>` tự chạy, không xác nhận được user có thực sự xem hay không.

Vì vậy trong admin panel có mục **Ad Slots** riêng, tách khỏi hệ thống nhiệm
vụ — dùng cho đúng loại quảng cáo "hiển thị thụ động, không chia tiền":

1. Vào `admin.html` → tab **Ad Slots** → "+ Thêm Ad Slot".
2. Dán **y nguyên** đoạn `<script>` Adsterra đưa cho bạn vào ô "Dán y nguyên đoạn script".
3. Chọn loại:
   - **Tự chạy (Popunder/Social Bar)** — không cần khung hiển thị, tự bật khi
     trang load hoặc user chạm màn hình.
   - **Banner** — sẽ hiển thị vào đúng khung `adBanner-{trang}` có sẵn trên
     từng tab của mini app (Dashboard/Nhiệm vụ/Ví/VIP).
4. Chọn trang áp dụng: toàn app hoặc chỉ 1 trang cụ thể.

Toàn bộ số tiền từ các Ad Slot này là **100% lợi nhuận admin** — không có công
thức chia sẻ nào ở đây vì không có cách nào xác minh user đã thực sự xem, nên
hệ thống không thể (và không nên) hứa trả user cho loại quảng cáo này.

Kỹ thuật: script dán qua HTML thường **không tự chạy** nếu chèn kiểu thô
(`innerHTML`), nên `public/index.html` có hàm `injectRawAdHtml()` tự dựng lại
đúng thẻ `<script>` để trình duyệt thực thi — bạn không cần chỉnh gì thêm, chỉ
cần dán snippet gốc vào admin panel là chạy được ngay.

## Cắm quảng cáo thật (Monetag / Adexium / Adsgram)

Toàn bộ SDK và logic gọi quảng cáo nằm trong `public/index.html`, tìm đoạn
`AD NETWORK SDKs` ở đầu file và hàm `showRewardedAd()`.

- **Monetag**: đăng ký tại monetag.com → lấy Zone ID → thay `YOUR_MONETAG_ZONE_ID`
  ở 2 chỗ (script tag `data-zone` + hàm `window.show_MONETAG_ZONE_ID`).
- **Adsgram**: lấy `blockId` từ dashboard Adsgram → thay `YOUR_ADSGRAM_BLOCK_ID`.
- **Adexium**: dashboard Adexium cho publisher một đoạn `<script>` + hàm gọi
  rewarded ad riêng — copy chính xác đoạn đó vào chỗ comment `TODO` trong
  `showRewardedAd()`. Vì mỗi publisher account có thể khác nhau đôi chút, hãy
  lấy trực tiếp từ dashboard của bạn thay vì đoán.

**Quan trọng**: sau khi tích hợp mỗi network, vào dashboard của họ xem CPM/eCPM
thực tế theo geo của bạn, rồi cập nhật `adminRevenuePerAction` cho từng nhiệm vụ
trong trang admin (`Nhiệm vụ / CPM`) — đây là con số quyết định user được trả bao
nhiêu và admin lời bao nhiêu. Nên cập nhật định kỳ vì eCPM dao động theo ngày/mùa.

## Xác minh postback (chống gian lận nâng cao — tùy chọn)
Hiện tại hệ thống tin vào `adminRevenuePerAction` admin đã cấu hình sẵn (an
toàn, không phụ thuộc client). Nếu muốn chính xác hơn theo từng lượt xem thật,
network nào có server-to-server postback (Adexium/Monetag đều có) thì bạn có thể
thêm một route `POST /api/postback/:network` nhận webhook từ network, verify chữ
ký, rồi mới `taskCompletion.update({ verified: true, sourceRevenue: <real> })` —
lúc đó `/complete` ở client chỉ tạo bản ghi `verified:false, reward:0`, và tiền
chỉ cộng vào balance sau khi postback xác nhận. Đây là bước nâng cao, không bắt
buộc để chạy hệ thống.

## Các lớp lợi nhuận admin đã có sẵn
1. **Revenue share trên mỗi task** (mặc định 50%, config được, không bao giờ
   cho user vượt quá `100% - 8%` sàn margin — xem `ADMIN_MIN_MARGIN_PERCENT`).
2. **Phí rút tiền** (`withdrawFeePercent`, mặc định 5%).
3. **Interstitial ads mỗi N lần bấm menu** (`interstitialEveryNClicks`) — không
   chia cho user, 100% vào tay admin.
4. **Gói VIP** (`vipPrices`) — user trả tiền thật (từ balance) để tăng % chia sẻ,
   admin thu tiền ngay khi mua; commission VIP boost vẫn có sàn margin nên admin
   vẫn lời trên mỗi lượt xem của VIP.
5. **Hoa hồng giới thiệu** được trả từ phần margin của admin, không trừ vào phần
   user nhận — nên vẫn kiểm soát được chi phí acquisition.

## Xoay vòng nhiều Zone/Ad ID + giới hạn nhiệm vụ nâng cao

Trong trang admin (`Nhiệm vụ / CPM` → Sửa/Thêm nhiệm vụ), mỗi nhiệm vụ giờ có:

- **Danh sách Zone/Block ID**: nhập nhiều ID cách nhau bằng dấu phẩy (VD: 3 zone
  Monetag khác nhau). Mỗi lần user bấm nhận nhiệm vụ, backend tự tính ID tiếp
  theo theo vòng (round-robin dựa trên số lần user đó đã làm nhiệm vụ này), trả
  về cho frontend qua field `nextZoneId`. Frontend tự động load đúng SDK/zone đó
  trước khi phát quảng cáo — không cần sửa code, chỉ cần nhập ID trong admin.
- **Giới hạn theo từng người**: cooldown giữa 2 lần, giới hạn/ngày, và giới hạn
  trọn đời (tổng số lần một user được làm nhiệm vụ này mãi mãi).
- **Giới hạn toàn hệ thống**: tổng lượt/ngày và tổng lượt trọn đời tính trên
  *tất cả* user cộng lại — dùng để khống chế ngân sách khi network trả CPM cao
  nhưng ngân sách quảng cáo của bạn có hạn, hoặc khi muốn giới hạn số lượt một
  chiến dịch offerwall/CPA cụ thể.

Mọi giới hạn được enforce ở `src/middleware/rateLimiter.js`, kiểm tra trước khi
cho phép hoàn thành nhiệm vụ — không thể bị bypass từ phía client.

## Cơ chế chống gian lận đã có
- Cooldown + giới hạn/ngày theo từng nhiệm vụ (`src/middleware/rateLimiter.js`).
- `sourceRevenue` luôn lấy từ config admin, không bao giờ tin số liệu client gửi lên.
- Xác thực `initData` bằng HMAC theo chuẩn Telegram, chặn phiên giả mạo/cũ quá 24h.
- Admin có thể ban user (`/api/admin/users/:id/ban`) — chặn hoàn toàn kiếm tiền
  và rút tiền.

## Việc cần làm tiếp
- [ ] Dán snippet SDK Adexium chính xác từ dashboard của bạn.
- [ ] Cập nhật `adminRevenuePerAction` theo eCPM thực tế mỗi network trả.
- [ ] Set `ADMIN_TELEGRAM_IDS` với Telegram ID thật của bạn.
- [ ] (Tùy chọn) nối cổng thanh toán tự động (MoMo API / bank API) thay vì duyệt tay.
