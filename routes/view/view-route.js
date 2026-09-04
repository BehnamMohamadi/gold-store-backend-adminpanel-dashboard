const express = require("express");

const User = require("../../models/user-model");

const { verifyAccessToken } = require("../../utils/jwt");

const { protect, restrictTo } = require("../../middleware/auth-middleware");

const router = express.Router();

const renderAdmin = (view, title) => (req, res) => {
  res.render(`admin/${view}`, {
    title,
    adminUser: req.user || null,
  });
};

router.get("/", (req, res) => {
  res.render("index", {
    title: "xxxxgold",
  });
});

router.get("/admin/login", async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;

    if (token) {
      try {
        const payload = verifyAccessToken(token);

        const user = await User.findById(payload.sub);

        if (user && user.role === "admin" && user.accountStatus?.status === "active") {
          return res.redirect("/admin");
        }
      } catch {
        // Invalid or expired token:
        // keep showing login page.
      }
    }

    return res.render("admin/login", {
      title: "ورود مدیر",
      adminUser: null,
    });
  } catch (err) {
    next(err);
  }
});

router.use("/admin", protect, restrictTo("admin"));

router.get("/admin", renderAdmin("dashboard", "داشبورد مدیریت"));

router.get("/admin/products", renderAdmin("products", "محصولات"));

router.get("/admin/products/new", (req, res) => {
  res.render("admin/product-form", {
    title: "افزودن محصول",
    adminUser: req.user,
    productId: "",
  });
});

router.get("/admin/products/:productId/edit", (req, res) => {
  res.render("admin/product-form", {
    title: "ویرایش محصول",
    adminUser: req.user,
    productId: req.params.productId,
  });
});

router.get("/admin/categories", renderAdmin("categories", "دسته‌بندی‌ها"));

router.get("/admin/subcategories", renderAdmin("subcategories", "زیردسته‌ها"));

router.get("/admin/gold-pricing", renderAdmin("gold-pricing", "قیمت طلا"));

router.get("/admin/orders", renderAdmin("orders", "سفارش‌ها"));

router.get("/admin/payments", renderAdmin("payments", "پرداخت‌ها"));

router.get("/admin/carts", renderAdmin("carts", "سبدهای خرید"));

router.get("/admin/orders/:orderId", (req, res) => {
  res.render("admin/order-details", {
    title: "جزئیات سفارش",
    adminUser: req.user,
    orderId: req.params.orderId,
  });
});

router.get("/admin/users", renderAdmin("users", "کاربران"));

module.exports = router;
