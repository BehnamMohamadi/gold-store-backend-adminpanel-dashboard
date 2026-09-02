const orderId =
  document.getElementById(
    "orderDetailsPage",
  ).dataset.orderId;

let currentOrder = null;

const meta = (items) =>
  items
    .map(
      ([key, value]) => `
        <div>
          <dt>${key}</dt>
          <dd>${value}</dd>
        </div>
      `,
    )
    .join("");

const renderOrder = (order) => {
  currentOrder = order;

  document.getElementById(
    "orderMeta",
  ).innerHTML = meta([
    [
      "شماره سفارش",
      AdminAPI.escape(
        order.orderNumber,
      ),
    ],

    [
      "مبلغ کل",
      AdminAPI.money(
        order.totalAmount,
      ),
    ],

    [
      "تعداد اقلام",
      AdminAPI.number(
        order.totalItems,
      ),
    ],

    [
      "وضعیت سفارش",
      AdminAPI.badge(
        order.status,
        "order",
      ),
    ],

    [
      "وضعیت پرداخت",
      AdminAPI.badge(
        order.paymentStatus,
        "payment",
      ),
    ],

    [
      "اعتبار قیمت تا",
      AdminAPI.date(
        order.priceExpiresAt,
      ),
    ],

    [
      "تاریخ ثبت",
      AdminAPI.date(
        order.createdAt,
      ),
    ],
  ]);

  const user = order.user || {};

  document.getElementById(
    "customerMeta",
  ).innerHTML = meta([
    [
      "نام",
      AdminAPI.escape(
        `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
          "—",
      ),
    ],

    [
      "موبایل",
      AdminAPI.escape(
        user.phonenumber || "—",
      ),
    ],

    [
      "ایمیل",
      AdminAPI.escape(
        user.email || "—",
      ),
    ],

    [
      "نقش",
      user.role === "admin"
        ? "ادمین"
        : "کاربر",
    ],
  ]);

  const statusForm =
    document.getElementById(
      "orderStatusForm",
    );

  statusForm.elements.status.value =
    order.status;

  statusForm.elements.paymentStatus.value =
    order.paymentStatus;

  const address =
    order.shippingAddressSnapshot;

  const addressPanel =
    document.getElementById(
      "shippingAddressPanel",
    );

  if (
    address &&
    address.addressLine
  ) {
    addressPanel.classList.remove(
      "hidden",
    );

    document.getElementById(
      "shippingAddress",
    ).innerHTML = `
      <div class="address-card-head">
        <b>
          ${AdminAPI.escape(
            address.title || "آدرس ارسال",
          )}
        </b>

        <span>
          ${AdminAPI.escape(
            address.recipientName || "",
          )}
        </span>
      </div>

      <p>
        ${AdminAPI.escape(
          `${address.province}، ${address.city}، ${address.addressLine}`,
        )}
      </p>

      <div class="address-meta-row">
        <span>
          موبایل:
          ${AdminAPI.escape(
            address.recipientPhone || "—",
          )}
        </span>

        <span>
          کد پستی:
          ${AdminAPI.escape(
            address.postalCode || "—",
          )}
        </span>

        ${
          address.buildingNumber
            ? `
              <span>
                پلاک:
                ${AdminAPI.escape(
                  address.buildingNumber,
                )}
              </span>
            `
            : ""
        }

        ${
          address.unit
            ? `
              <span>
                واحد:
                ${AdminAPI.escape(
                  address.unit,
                )}
              </span>
            `
            : ""
        }
      </div>
    `;
  } else {
    addressPanel.classList.add(
      "hidden",
    );
  }

  document.getElementById(
    "orderItems",
  ).innerHTML =
    (order.items || [])
      .map((item) => {
        const pricing =
          item.pricingSnapshot ||
          {};

        return `
          <article class="order-item">
            <img
              src="${AdminAPI.escape(
                item.productSnapshot
                  ?.coverImage || "",
              )}"
              alt=""
            >

            <div class="order-product">
              <b>
                ${AdminAPI.escape(
                  item.productSnapshot
                    ?.name || "—",
                )}
              </b>

              <small>
                ${AdminAPI.escape(
                  item.productSnapshot
                    ?.sku || "",
                )}
                • تعداد
                ${AdminAPI.number(
                  item.quantity,
                )}
              </small>

              <small>
                ${AdminAPI.money(
                  item.totalPrice,
                )}
              </small>
            </div>

            <div class="snapshot-grid">
              <div>
                <span>وزن</span>
                <b>
                  ${AdminAPI.number(
                    pricing.goldWeight,
                  )}
                  g
                </b>
              </div>

              <div>
                <span>عیار</span>
                <b>
                  ${AdminAPI.number(
                    pricing.karat,
                  )}
                </b>
              </div>

              <div>
                <span>قیمت گرم</span>
                <b>
                  ${AdminAPI.number(
                    pricing.goldPricePerGram,
                  )}
                </b>
              </div>

              <div>
                <span>ارزش طلا</span>
                <b>
                  ${AdminAPI.number(
                    pricing.goldValue,
                  )}
                </b>
              </div>

              <div>
                <span>اجرت</span>
                <b>
                  ${AdminAPI.number(
                    pricing.wage?.amount,
                  )}
                </b>
              </div>

              <div>
                <span>سود</span>
                <b>
                  ${AdminAPI.number(
                    pricing.profit?.amount,
                  )}
                </b>
              </div>

              <div>
                <span>مالیات</span>
                <b>
                  ${AdminAPI.number(
                    pricing.tax?.amount,
                  )}
                </b>
              </div>

              <div>
                <span>متعلقات</span>
                <b>
                  ${AdminAPI.number(
                    pricing.accessoriesPrice,
                  )}
                </b>
              </div>
            </div>
          </article>
        `;
      })
      .join("") ||
    `
      <div class="note-box small">
        آیتمی وجود ندارد.
      </div>
    `;
};

const loadOrder = async () => {
  try {
    const payload =
      await AdminAPI.request(
        `/api/orders/admin/${orderId}`,
      );

    renderOrder(
      payload?.data?.order,
    );
  } catch (error) {
    adminToast(
      error.message,
      "error",
    );
  }
};

document.getElementById(
  "orderStatusForm",
).addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const form =
      event.currentTarget;

    const button =
      document.getElementById(
        "saveOrderStatus",
      );

    button.disabled = true;

    try {
      const payload =
        await AdminAPI.request(
          `/api/orders/admin/${orderId}`,
          {
            method: "PATCH",

            body: {
              status:
                form.elements
                  .status.value,

              paymentStatus:
                form.elements
                  .paymentStatus
                  .value,
            },
          },
        );

      adminToast(
        "وضعیت سفارش بروزرسانی شد.",
      );

      await loadOrder();
    } catch (error) {
      adminToast(
        error.message,
        "error",
      );
    } finally {
      button.disabled = false;
    }
  },
);

loadOrder();
