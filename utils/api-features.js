class ApiFeatures {
  constructor(query, queryString, excludedFields = []) {
    this.query = query;
    this.queryString = queryString;
    this.excludedFields = excludedFields;
    this.filterObject = {};
  }

  filter() {
    const { sort, page, limit, fields, ...filter } = this.queryString;

    const filterAsJson = JSON.stringify(filter).replace(
      /\b(gt|gte|lt|lte)\b/g,
      (match) => `$${match}`,
    );

    this.filterObject = JSON.parse(filterAsJson);

    this.query = this.query.find(this.filterObject);

    return this;
  }

  sort() {
    const { sort = "-createdAt" } = this.queryString;

    const sortBy = sort.split(",").join(" ");

    this.query = this.query.sort(sortBy);

    return this;
  }

  limitFields() {
    const { fields } = this.queryString;

    if (fields) {
      const selectedFields = fields
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
        .filter((field) => {
          const fieldName = field.replace(/^-/, "");

          return !this.excludedFields.includes(fieldName);
        });

      this.query = this.query.select(selectedFields.join(" "));
    } else {
      const excluded = ["__v", ...this.excludedFields]
        .map((field) => `-${field}`)
        .join(" ");

      this.query = this.query.select(excluded);
    }

    return this;
  }

  paginate() {
    const page = Math.max(Number(this.queryString.page) || 1, 1);

    const limit = Math.min(Math.max(Number(this.queryString.limit) || 10, 1), 100);

    const skip = (page - 1) * limit;

    this.page = page;
    this.limit = limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}

module.exports = {
  ApiFeatures,
};
