# Cờ Tỉ Phú Việt Nam V0.29.1 – Socket.IO Online

Dự án này gồm cả giao diện game và máy chủ Socket.IO. GitHub dùng để lưu mã nguồn; để chơi online, cần chạy `server.js` trên một máy chủ Node.js hoặc triển khai toàn bộ repository lên Render.

## Chạy trên máy tính

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm start
```

Mở `http://localhost:3000` trên trình duyệt.

## Cách chơi online

1. Chủ phòng mở game, thiết lập người chơi và nhấn **Bắt đầu chơi**.
2. Chủ phòng nhấn **Tạo phòng**, sau đó sao chép đường link hoặc mã gồm 6 ký tự.
3. Những người còn lại mở link, chọn **Vào phòng**, kiểm tra mã và chọn đúng tên của mình.
4. Chỉ thiết bị của người đang đến lượt mới được gửi thao tác lên máy chủ.
5. Nếu tải lại trang, thiết bị tự dùng mã nhận diện đã lưu để vào lại đúng ghế.

## Các sự kiện Socket.IO

| Chiều | Sự kiện | Công dụng |
|---|---|---|
| Client → Server | `room:create` | Tạo phòng từ ván hiện tại |
| Client → Server | `room:inspect` | Xem danh sách ghế trong phòng |
| Client → Server | `room:join` | Chọn ghế và tham gia |
| Client → Server | `room:resume` | Vào lại sau khi mất kết nối |
| Client → Server | `game:state` | Gửi trạng thái game mới |
| Client → Server | `game:state-request` | Yêu cầu trạng thái mới nhất |
| Server → Client | `game:state` | Đồng bộ trạng thái cho người khác |
| Server → Client | `room:members` | Cập nhật người đang online |
| Server → Client | `room:closed` | Báo phòng hết hạn |

Máy chủ kiểm tra mã phiên bản và chỉ chấp nhận cập nhật từ ghế của người đang đến lượt.

## Đưa lên GitHub và Render miễn phí

1. Tạo một repository GitHub mới.
2. Giải nén gói và tải **các tệp bên trong** lên thư mục gốc của repository, không tải nguyên một thư mục lồng bên ngoài.
3. Kiểm tra trên GitHub phải có đúng cấu trúc tối thiểu sau:

```text
server.js
package.json
package-lock.json
render.yaml
public/
  index.html
```

Gói sửa lỗi cũng có thêm `index.html` ở thư mục gốc để máy chủ vẫn mở được game nếu GitHub làm mất cấu trúc thư mục `public`.

4. Đăng nhập Render và chọn **New → Blueprint** hoặc **New → Web Service**.
5. Kết nối repository GitHub. Render sẽ đọc `render.yaml` hoặc dùng:
   - Build command: `npm install && npm run check`
   - Start command: `npm start`
   - Health check: `/health`
6. Sau khi triển khai xong, trong log phải có dòng `Đang phục vụ giao diện từ: public/index.html` (hoặc `index.html`), rồi mở địa chỉ `https://...onrender.com` được cấp.

Không cần bật GitHub Pages nếu dùng cách này, vì chính máy chủ Node.js cũng phục vụ file `public/index.html`.

Trong cửa sổ **Chơi online**, hãy để trống ô **Máy chủ online** khi đang mở game bằng địa chỉ Render. Chỉ nhập địa chỉ đầy đủ dạng `https://...onrender.com` khi giao diện và máy chủ được đặt ở hai nơi khác nhau; không nhập mã phòng hoặc số như `11` vào ô này.

### Sửa lỗi `ENOENT ... public/index.html`

Lỗi này có nghĩa là máy chủ đã chạy nhưng GitHub không có tệp `public/index.html`. Hãy tải lại toàn bộ nội dung gói, xác nhận GitHub hiển thị được đường dẫn `public/index.html`, rồi trên Render chọn **Manual Deploy → Deploy latest commit**. Bước build mới sẽ dừng sớm và báo rõ nếu cả ba tệp `public/index.html`, `index.html`, `index (1).html` đều không tồn tại.

## Lưu ý

- Trạng thái phòng hiện được giữ trong bộ nhớ máy chủ. Nếu dịch vụ khởi động lại hoặc ngủ rồi bị làm mới, phòng đang chơi có thể mất.
- Bản miễn phí phù hợp để thử nghiệm và chơi với bạn bè, không phải hạ tầng thi đấu công khai.
- Nếu đặt giao diện trên GitHub Pages và máy chủ ở địa chỉ khác, nhập URL máy chủ vào ô **Địa chỉ máy chủ Socket.IO**, đồng thời đặt biến môi trường `CLIENT_ORIGIN` trên máy chủ bằng địa chỉ GitHub Pages.
- Thư mục `assets/cards/` cần được bổ sung nếu muốn hiển thị ảnh mặt trước và mặt sau của các thẻ bài.
