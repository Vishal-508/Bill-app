import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, PowerOff, Power, AlertCircle } from 'lucide-react';
import {
  useProductDetail, useUpdateProduct,
} from '../../hooks/queries/useProducts.js';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import ProductHeader from './ProductHeader.jsx';
import ProductTabs from './ProductTabs.jsx';
import ProductFormModal from './ProductFormModal.jsx';
import { ROUTES } from '../../utils/constants.js';

export default function ProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const productQuery = useProductDetail(productId);
  const updateMutation = useUpdateProduct();

  const [editOpen, setEditOpen] = useState(false);

  const product = productQuery.data?.data;

  if (productQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (productQuery.isError || !product) {
    const status = productQuery.error?.response?.status;
    return (
      <div className="space-y-4">
        <button onClick={() => navigate(ROUTES.PRODUCTS)}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700">
          <ArrowLeft size={14} /> Back to Products
        </button>
        <Card>
          <Card.Body>
            <Alert variant="error">
              {status === 404
                ? 'Product not found — it may have been deleted.'
                : `Could not load product (${productQuery.error?.message || 'unknown error'}).`}
            </Alert>
          </Card.Body>
        </Card>
      </div>
    );
  }

  const handleToggleActive = async () => {
    const next = !product.isActive;
    const verb = next ? 'reactivate' : 'deactivate';
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${product.name}?`)) return;
    try {
      await updateMutation.mutateAsync({
        id: product._id,
        payload: { isActive: next },
      });
    } catch { /* toast surfaced by hook */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate(ROUTES.PRODUCTS);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1.5 py-0.5"
        >
          <ArrowLeft size={14} /> Back to Products
        </button>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<Pencil size={14} />}
            onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          {product.isActive ? (
            <Button variant="outline" size="sm" leftIcon={<PowerOff size={14} />}
              loading={updateMutation.isPending}
              onClick={handleToggleActive}>
              Deactivate
            </Button>
          ) : (
            <Button variant="primary" size="sm" leftIcon={<Power size={14} />}
              loading={updateMutation.isPending}
              onClick={handleToggleActive}>
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {!product.isActive && (
        <Alert variant="warning" className="!py-2">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle size={14} />
            <span>This product is currently inactive. Reactivate to allow new orders.</span>
          </div>
        </Alert>
      )}

      <ProductHeader product={product} />
      <ProductTabs product={product} />

      {editOpen && (
        <ProductFormModal
          open
          product={product}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
