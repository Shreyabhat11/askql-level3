import os
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from ml.preprocess import preprocess

TRAINING_DATA = [
    # SUM
    ("what is the total amount of all orders", "SUM"),
    ("sum of all order amounts", "SUM"),
    ("total revenue from orders", "SUM"),
    ("how much total sales do we have", "SUM"),
    ("calculate total order value", "SUM"),
    ("sum orders amount", "SUM"),
    ("what is total spending", "SUM"),

    # AVG
    ("what is the average order amount", "AVG"),
    ("average revenue per order", "AVG"),
    ("mean order value", "AVG"),
    ("what is the average spending", "AVG"),
    ("average amount spent by customers", "AVG"),
    ("find the mean amount of orders", "AVG"),

    # COUNT
    ("how many orders are there", "COUNT"),
    ("count all customers", "COUNT"),
    ("how many customers do we have", "COUNT"),
    ("number of orders placed", "COUNT"),
    ("total count of orders", "COUNT"),
    ("how many records in orders", "COUNT"),
    ("count orders from usa", "COUNT"),

    # FILTER
    ("show orders greater than 500", "FILTER"),
    ("orders where amount is less than 200", "FILTER"),
    ("customers from usa", "FILTER"),
    ("find customers in germany", "FILTER"),
    ("orders placed after 2024-03-01", "FILTER"),
    ("show me orders with amount above 300", "FILTER"),
    ("customers from uk", "FILTER"),
    ("filter orders by country usa", "FILTER"),

    # GROUP_BY
    ("total orders grouped by country", "GROUP_BY"),
    ("sum of orders per customer", "GROUP_BY"),
    ("order count by country", "GROUP_BY"),
    ("group customers by country", "GROUP_BY"),
    ("revenue per customer", "GROUP_BY"),
    ("how many orders per customer", "GROUP_BY"),
    ("group orders by customer id", "GROUP_BY"),
    ("total amount by country", "GROUP_BY"),

    # TOP_N
    ("top 5 customers by order amount", "TOP_N"),
    ("show top 10 orders", "TOP_N"),
    ("top 3 highest orders", "TOP_N"),
    ("first 5 customers", "TOP_N"),
    ("limit 10 orders", "TOP_N"),
    ("top customers ranked by spending", "TOP_N"),
    ("show the top 5 revenue orders", "TOP_N"),

    # JOIN
    ("show customer names with their order amounts", "JOIN"),
    ("list customers and their orders", "JOIN"),
    ("join customers with orders", "JOIN"),
    ("customer name and order date", "JOIN"),
    ("show name and amount for all orders", "JOIN"),
    ("which customers placed orders", "JOIN"),
    ("customer details with order history", "JOIN"),
    ("show all orders with customer names", "JOIN"),
]

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))


def train():
    texts, labels = zip(*TRAINING_DATA)
    texts = [preprocess(t) for t in texts]

    vectorizer = TfidfVectorizer(ngram_range=(1, 2), max_features=500)
    clf = LogisticRegression(max_iter=1000, C=2.0)

    X = vectorizer.fit_transform(texts)
    clf.fit(X, labels)

    with open(os.path.join(MODEL_DIR, "intent_model.pkl"), "wb") as f:
        pickle.dump(clf, f)
    with open(os.path.join(MODEL_DIR, "vectorizer.pkl"), "wb") as f:
        pickle.dump(vectorizer, f)

    print("Model trained and saved.")
    print(f"Classes: {clf.classes_}")


if __name__ == "__main__":
    train()
